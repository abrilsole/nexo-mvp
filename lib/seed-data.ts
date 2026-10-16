// ─────────────────────────────────────────────────────────────
// Datos demo — empresa ficticia Madera Sur S.R.L.
// Las fechas se generan relativas a "hoy" para que las alertas de
// fechas / registros tengan sentido cada vez que se resetea la demo.
// Ningún nombre corresponde a empresas o clientes reales.
// ─────────────────────────────────────────────────────────────
import type {
  WorkAssignment,
  PurchaseOrder,
  PurchaseOrderLine,
  ActivityEvent,
  ActualEntry,
  ActualEntryType,
  BudgetCategory,
  RubroId,
  BudgetLine,
  MaterialSource,
  MaterialUsageEntry,
  Operator,
  Project,
  ProjectStatus,
  PurchaseEntry,
  ReusableMaterial,
  StageLog,
} from "@/types";
import { ACTUAL_TYPE_LABELS, DEFAULT_SETTINGS, DEMO_USERS, MATERIAL_CATALOG, STATUS_LABELS, STATUS_ORDER, type OtherCostCategory } from "./constants";
import { actualInputCategory, registerUsage } from "./project-operations";
import { invoiceActivity, invoiceEntries, receiveOrder, receivedState } from "./purchasing";
import { applyChange } from "./stock";
import { budgetLineTotal } from "./calculations";
import { toISODate } from "./formatting";
import { rubroLabel } from "./rubros";
import { activityTimeline, actualMessage, leftoverMessage, purchaseMessage, usageMessage } from "./activity";
import { applyUsageToPool, poolAvailableFor } from "./reusable-pool";
import { deriveLedgerFromLegacy } from "./stock-legacy";
import type { StockState } from "./stock";

const MGMT = DEMO_USERS.admin.name;
const PLANTA = DEMO_USERS.jefe_planta.name;

interface BudgetSpec {
  materials: Array<[materialId: string, qty: number, unitCost: number]>;
  /** Mano de obra de Carpintería madera: [horas, tarifa]. */
  labor?: [hours: number, rate: number];
  /** Mano de obra de otros rubros (proyecto estrella): [rubro, horas, tarifa, operarios]. */
  laborRubros?: Array<[rubro: RubroId, hours: number, rate: number, workers: number]>;
  /** Horas de diseño y de administración del rubro Carpintería madera: [horas, tarifa]. */
  hours?: Partial<Record<"design" | "admin", [hours: number, rate: number]>>;
  /** Importes globales por rubro (como los cargaría el Cotizador). */
  direct?: Partial<Record<keyof typeof DIRECT_LINES, number>>;
}

type UsageSpec = [
  dayOffset: number,
  materialId: string,
  consumed: number,
  waste: number,
  leftover: number,
  unitCost: number,
  source?: MaterialSource,
  by?: string,
];
type PurchaseSpec = [dayOffset: number, materialId: string, qty: number, unitCost: number, supplier?: string];
/**
 * Producto del proyecto: [id, nombre, cantidad, unidades terminadas, rubros: [rubro, horas estimadas, operarios]].
 * Las horas estimadas son para toda la cantidad.
 */
type ProductSpec = [id: string, name: string, quantity: number, completed: number, rubros: Array<[rubro: RubroId, hours: number, workers: number]>];
/**
 * Trabajo ya hecho: desde `fromDay`, el operario tuvo asignadas `planned` horas en el producto + rubro (en días
 * hábiles de hasta 8 h, sin pisar otros días suyos) y cargó `logged` horas contra esas asignaciones.
 * `rate`: costo por hora congelado (si falta, el del operario).
 */
type WorkSpec = [fromDay: number, operatorId: string, itemId: string, rubro: RubroId, planned: number, logged: number, rate?: number];
type CostSpec = [
  dayOffset: number,
  type: Exclude<ActualEntryType, "labor">,
  description: string,
  amount: number,
  supplier?: string,
  /** Solo "other": Diseño, Administración o Gasto financiero. */
  category?: OtherCostCategory,
];

interface ProjectSpec {
  id: string;
  code: string;
  name: string;
  client: string;
  projectType: string;
  description: string;
  status: ProjectStatus;
  start: number; // offset en días desde hoy
  due: number;
  salesPrice: number;
  owner: string;
  budget: BudgetSpec;
  purchases?: PurchaseSpec[];
  usages?: UsageSpec[];
  products?: ProductSpec[];
  work?: WorkSpec[];
  costs?: CostSpec[];
  closedAt?: number;
}

const DIRECT_LINES = {
  bought: { category: "materials", rubro: "pintura", description: "Pintura / Laqueados: trabajo comprado hecho" },
  transport: { category: "transport", rubro: "transporte", description: "Transporte / Fletes" },
  montaje: { category: "labor", rubro: "montaje", description: "Montaje: instalación en obra" },
  contingency: { category: "contingency", rubro: "imprevistos", description: "Imprevistos" },
} as const satisfies Record<string, { category: BudgetCategory; rubro: RubroId; description: string }>;

function material(id: string) {
  const m = MATERIAL_CATALOG.find((x) => x.id === id);
  if (!m) throw new Error(`Material de catálogo inexistente: ${id}`);
  return m;
}

/** Operarios de la demo: ids estables para vincular horas y asignaciones. */
const OPERATOR_SPECS: Array<{ id: string; name: string; role: string; hourlyCost: number }> = [
  { id: "op-juan", name: "Juan Pérez", role: "Carpintería", hourlyCost: 15_000 },
  { id: "op-diego", name: "Diego Sosa", role: "Armado", hourlyCost: 12_500 },
  { id: "op-marcos", name: "Marcos Gil", role: "Herrería", hourlyCost: 14_000 },
  { id: "op-lucia", name: "Lucía Ferreyra", role: "Embalaje y terminaciones", hourlyCost: 11_000 },
  { id: "op-sofia", name: "Sofía Méndez", role: "Oficina técnica", hourlyCost: 15_000 },
];

/** Horas máximas de una asignación del seed por día. */
const SEED_DAY_HOURS = 8;

class SeedBuilder {
  private seq = 0;
  pool: ReusableMaterial[] = [];
  /** Asignaciones de toda la demo (pasadas, con sus horas cargadas, y las de hoy en adelante). */
  assignments: WorkAssignment[] = [];
  /** Días ya ocupados de cada operario (un día no se asigna dos veces en el trabajo ya hecho). */
  private busy = new Map<string, Set<number>>();
  constructor(private readonly now: Date) {}

  /** Próximo día hábil (lunes a viernes) libre del operario desde `from`. */
  private freeDay(operatorId: string, from: number): number {
    const used = this.busy.get(operatorId) ?? new Set<number>();
    let off = from;
    for (;;) {
      const dow = new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate() + off).getDay();
      if (dow !== 0 && dow !== 6 && !used.has(off)) break;
      off += 1;
    }
    used.add(off);
    this.busy.set(operatorId, used);
    return off;
  }

  assignment(projectId: string, itemId: string, rubro: RubroId, operatorId: string, off: number, plannedHours: number): WorkAssignment {
    const a: WorkAssignment = {
      id: `asg-${(this.assignments.length + 1).toString().padStart(4, "0")}`,
      projectId,
      itemId,
      rubro,
      operatorId,
      date: this.day(off),
      plannedHours,
      createdBy: PLANTA,
      createdAt: this.at(off - 3, 9),
    };
    this.assignments.push(a);
    return a;
  }

  /** Trabajo ya hecho: asignaciones en días hábiles pasados y las horas cargadas contra cada una. */
  work(p: Project, [from, operatorId, itemId, rubro, planned, logged, rate]: WorkSpec): ActualEntry[] {
    const op = OPERATOR_SPECS.find((o) => o.id === operatorId);
    if (!op) throw new Error(`Seed: operario inexistente ${operatorId}`);
    const days = Math.max(1, Math.ceil(planned / SEED_DAY_HOURS));
    const half = (n: number) => Math.round(n * 2) / 2;
    const entries: ActualEntry[] = [];
    let plannedLeft = planned;
    let loggedLeft = logged;
    for (let d = 0; d < days; d++) {
      const last = d === days - 1;
      const plan = last ? plannedLeft : half(planned / days);
      const done = last ? loggedLeft : half(logged / days);
      plannedLeft -= plan;
      loggedLeft -= done;
      const off = this.freeDay(operatorId, from);
      if (off >= 0) throw new Error(`Seed: el trabajo de ${op.name} en ${p.code} no entra antes de hoy`);
      const a = this.assignment(p.id, itemId, rubro, operatorId, off, plan);
      if (!(done > 0)) continue;
      const hourlyCost = rate ?? op.hourlyCost;
      entries.push({
        id: this.id("act"),
        projectId: p.id,
        date: a.date,
        type: "labor",
        category: "labor",
        description: `${rubroLabel(rubro)} — ${op.name}`,
        amount: done * hourlyCost,
        labor: { role: rubroLabel(rubro), workerName: op.name, hours: done, hourlyCost },
        operatorId,
        stage: "production",
        itemId,
        rubro,
        assignmentId: a.id,
        createdBy: op.name,
        createdAt: this.at(off, 18),
      });
    }
    return entries;
  }


  id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq.toString().padStart(4, "0")}`;
  }
  day(offset: number): string {
    const d = new Date(this.now);
    d.setDate(d.getDate() + offset);
    return toISODate(d);
  }
  /** Momento de un evento. Nunca posterior a "ahora": un registro no puede ocurrir en el futuro. */
  at(offset: number, hour = 10): string {
    const d = new Date(this.now);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, (this.seq * 7) % 60, 0, 0);
    return (d.getTime() > this.now.getTime() ? this.now : d).toISOString();
  }

  budgetLines(spec: BudgetSpec): BudgetLine[] {
    const lines: BudgetLine[] = spec.materials.map(([mid, qty, cost]) => {
      const m = material(mid);
      const base = { quantity: qty, unitCost: cost };
      return {
        id: this.id("bl"),
        category: "materials",
        rubro: m.rubro,
        description: m.name,
        materialId: m.id,
        unit: m.unit,
        ...base,
        total: budgetLineTotal(base),
      };
    });
    if (spec.labor) {
      const [hours, rate] = spec.labor;
      lines.push({
        id: this.id("bl"),
        category: "labor",
        rubro: "carpinteria_madera",
        description: "Carpintería madera: mano de obra (corte, armado)",
        quantity: hours,
        unit: "h",
        unitCost: rate,
        total: budgetLineTotal({ quantity: hours, unitCost: rate }),
      });
    }
    for (const [rubro, hours, rate, workers] of spec.laborRubros ?? []) {
      lines.push({
        id: this.id("bl"),
        category: "labor",
        rubro,
        description: `${rubroLabel(rubro)}: mano de obra (${workers} ${workers === 1 ? "operario" : "operarios"} × ${hours / workers} h)`,
        quantity: hours,
        unit: "h",
        unitCost: rate,
        total: budgetLineTotal({ quantity: hours, unitCost: rate }),
        workers,
      });
    }
    for (const [category, [hours, rate]] of Object.entries(spec.hours ?? {}) as Array<["design" | "admin", [number, number]]>) {
      lines.push({
        id: this.id("bl"),
        category,
        rubro: "carpinteria_madera",
        description: `Carpintería madera: horas de ${category === "design" ? "diseño" : "administración"}`,
        quantity: hours,
        unit: "h",
        unitCost: rate,
        total: budgetLineTotal({ quantity: hours, unitCost: rate }),
        hourRateId: category,
        hourType: "normal",
      });
    }
    for (const [key, amount] of Object.entries(spec.direct ?? {}) as Array<[keyof typeof DIRECT_LINES, number]>) {
      const d = DIRECT_LINES[key];
      lines.push({
        id: this.id("bl"),
        category: d.category,
        rubro: d.rubro,
        description: d.description,
        quantity: null,
        unit: "global",
        unitCost: amount,
        total: amount,
      });
    }
    return lines;
  }

  project(spec: ProjectSpec): Project {
    const p: Project = {
      id: spec.id,
      code: spec.code,
      name: spec.name,
      client: spec.client,
      projectType: spec.projectType,
      description: spec.description,
      status: spec.status,
      startDate: this.day(spec.start),
      dueDate: this.day(spec.due),
      createdAt: this.at(spec.start - 10, 9),
      updatedAt: this.at(0, 8),
      salesPrice: spec.salesPrice,
      owner: spec.owner,
      budgetLines: this.budgetLines(spec.budget),
      actualEntries: [],
      materialUsages: [],
      purchaseEntries: [],
      activity: [],
      isClosed: spec.status === "completed",
      closedAt: spec.closedAt !== undefined ? this.at(spec.closedAt, 17) : undefined,
      assignedOperatorIds: [],
      items: (spec.products ?? []).map(([id, name, quantity, completed, rubros]) => ({
        id,
        name,
        quantity,
        completedUnits: completed,
        rubros: rubros.map(([rubro, hours, workers]) => ({ rubro, hours, workers })),
      })),
      stageLogs: [],
      attachments: [],
    };
    const events: ActivityEvent[] = [];
    const ev = (offset: number, kind: ActivityEvent["kind"], actor: string, message: string, hour = 10) =>
      events.push({ id: this.id("act"), at: this.at(offset, hour), kind, actor, message });

    ev(spec.start - 10, "created", MGMT, "Proyecto creado.", 9);
    // Historia de estados hasta el actual
    const idx = STATUS_ORDER.indexOf(spec.status);
    const span = Math.max(1, (spec.closedAt ?? 0) - spec.start);
    for (let i = 1; i <= idx; i++) {
      const s = STATUS_ORDER[i];
      const off = i === 1 ? spec.start - 3 : spec.start + Math.round(((i - 2) / 4) * span);
      if (s === "approved") ev(off, "status", MGMT, "Proyecto aprobado: el costo presupuestado queda congelado como presupuesto base.", 11);
      else if (s === "completed") continue;
      else ev(off, "status", MGMT, `Proyecto pasó a la etapa ${STATUS_LABELS[s]}.`, 11);
    }

    for (const [off, mid, qty, cost, supplier] of spec.purchases ?? []) {
      const m = material(mid);
      const pe: PurchaseEntry = {
        id: this.id("pur"),
        projectId: p.id,
        materialId: m.id,
        materialName: m.name,
        quantity: qty,
        unit: m.unit,
        unitCost: cost,
        total: qty * cost,
        supplier,
        date: this.day(off),
        createdBy: MGMT,
        createdAt: this.at(off, 12),
      };
      p.purchaseEntries.push(pe);
      ev(off, "purchase", MGMT, purchaseMessage(pe), 12);
    }

    for (const [off, mid, consumed, waste, leftover, cost, source = "purchased_for_project", by = PLANTA] of spec.usages ??
      []) {
      const m = material(mid);
      let reusableMaterialId: string | undefined;
      let unitCost = cost;
      if (source === "reused_leftover") {
        const item = poolAvailableFor(this.pool, mid)[0];
        if (!item) throw new Error(`Seed: no hay sobrante de ${mid} para reutilizar`);
        reusableMaterialId = item.id;
        unitCost = item.unitCost;
      }
      const u: MaterialUsageEntry = {
        id: this.id("use"),
        projectId: p.id,
        materialId: m.id,
        materialName: m.name,
        date: this.day(off),
        quantityConsumed: consumed,
        wasteQuantity: waste,
        reusableLeftoverQuantity: leftover,
        unit: m.unit,
        unitCost,
        unitCostOrigin: source === "reused_leftover" ? "reusable_pool" : source === "existing_stock" ? "catalog" : "purchase",
        source,
        reusableMaterialId,
        createdBy: by,
        createdAt: this.at(off, 15),
      };
      this.pool = applyUsageToPool(this.pool, u, p, this.id("reu"));
      p.materialUsages.push(u);
      ev(off, "usage", by, usageMessage(u), 15);
      if (leftover > 0) ev(off, "leftover", "Sistema", leftoverMessage(u.materialName, leftover, u.unit), 15);
    }

    for (const w of spec.work ?? []) {
      for (const e of this.work(p, w)) {
        p.actualEntries.push(e);
        ev(Math.round((Date.parse(e.date) - Date.parse(this.day(0))) / 86_400_000), "cost", e.createdBy, actualMessage(e), 18);
      }
    }

    for (const [off, type, description, amount, supplier, category] of spec.costs ?? []) {
      const e: ActualEntry = {
        id: this.id("act"),
        projectId: p.id,
        date: this.day(off),
        type,
        category: actualInputCategory({ type, category }),
        description: description || ACTUAL_TYPE_LABELS[type],
        amount,
        supplier,
        createdBy: MGMT,
        createdAt: this.at(off, 16),
      };
      p.actualEntries.push(e);
      ev(off, "cost", MGMT, actualMessage(e), 16);
    }

    if (spec.status === "completed" && spec.closedAt !== undefined) {
      ev(spec.closedAt, "closed", MGMT, "Proyecto cerrado. Rentabilidad real calculada.", 17);
    }
    p.activity = activityTimeline(events, this.now.toISOString());
    // Línea base: el presupuesto con el que se aprobó el proyecto.
    if (spec.status !== "quotation") {
      p.baseline = {
        capturedAt: this.at(spec.start - 3, 11),
        capturedBy: MGMT,
        salesPrice: p.salesPrice,
        dueDate: p.dueDate,
        budgetTotal: p.budgetLines.reduce((sum, l) => sum + l.total, 0),
        lines: p.budgetLines.map((l) => ({ ...l })),
      };
    }
    // Equipo del proyecto: los operarios con asignaciones (se completa con las de hoy en adelante en buildSeed).
    const team = new Set(this.assignments.filter((a) => a.projectId === p.id).map((a) => a.operatorId));
    p.assignedOperatorIds = OPERATOR_SPECS.map((o) => o.id).filter((id) => team.has(id));
    return p;
  }
}

export interface SeedState {
  projects: Project[];
  operators: Operator[];
  /** Asignaciones del Jefe de planta: las pasadas (con sus horas cargadas) y las de hoy en adelante. */
  assignments: WorkAssignment[];
  /** Órdenes de compra del proyecto estrella: facturada y recibida, facturada y recibida en parte, borrador. */
  orders: PurchaseOrder[];
  /** Stock inicial: se deriva de las compras, usos y sobrantes de la demo. */
  stock: StockState;
  /** Pool del modelo anterior (sólo para derivar el stock). */
  legacyPool: ReusableMaterial[];
}

export const MAIN_DEMO_PROJECT_ID = "p-1042";

/** Proyecto estrella de la demo (10 mesas + 100 sillas): recorre los 4 roles. */
export const STAR_PROJECT_ID = "p-1058";

/**
 * Asignaciones de hoy en adelante (todavía sin horas): [día, operario, proyecto, producto, rubro, horas].
 * Hoy Juan trabaja en las sillas del proyecto estrella: es lo que ve en "Mi día".
 */
const UPCOMING: Array<[number, string, string, string, RubroId, number]> = [
  [0, "op-juan", STAR_PROJECT_ID, "itm-sillas", "carpinteria_madera", 8],
  [0, "op-diego", "p-1045", "itm-1045-puestos", "carpinteria_madera", 8],
  [0, "op-marcos", STAR_PROJECT_ID, "itm-sillas", "carpinteria_metalica", 8],
  [0, "op-lucia", "p-1047", "itm-1047-stand", "carpinteria_madera", 6],
  [1, "op-juan", STAR_PROJECT_ID, "itm-sillas", "carpinteria_madera", 8],
  [1, "op-diego", STAR_PROJECT_ID, "itm-sillas", "carpinteria_madera", 8],
  [1, "op-marcos", STAR_PROJECT_ID, "itm-sillas", "carpinteria_metalica", 8],
  [2, "op-juan", MAIN_DEMO_PROJECT_ID, "itm-murales", "carpinteria_madera", 8],
  [2, "op-diego", "p-1048", "itm-1048-exhib", "carpinteria_madera", 8],
  [3, "op-juan", MAIN_DEMO_PROJECT_ID, "itm-gondolas", "carpinteria_madera", 8],
  [3, "op-diego", "p-1045", "itm-1045-puestos", "carpinteria_madera", 8],
];

export function buildSeed(now: Date = new Date()): SeedState {
  const b = new SeedBuilder(now);
  const projects: Project[] = [];

  // ── Proyectos finalizados (base del historial y del pool de sobrantes) ──
  projects.push(
    b.project({
      id: "p-0987",
      code: "P-0987",
      name: "Café Recoleta – Barra y estanterías",
      client: "Café Tostado",
      projectType: "Local comercial",
      description: "Barra de atención, estanterías de exhibición y alacenas.",
      status: "completed",
      start: -170,
      due: -125,
      closedAt: -122,
      salesPrice: 6_500_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mel-grafito-18", 14, 58_000],
          ["fenolico", 8, 65_000],
          ["tapacanto", 300, 900],
          ["bisagra", 60, 2_300],
        ],
        labor: [80, 14_000],
        direct: { bought: 300_000, transport: 200_000, montaje: 400_000, contingency: 300_000 },
      },
      purchases: [
        [-160, "mel-grafito-18", 16, 60_000, "Maderera Oeste"],
        [-160, "fenolico", 10, 70_000, "Maderera Oeste"],
        [-160, "tapacanto", 350, 950, "Herrajes Sur"],
      ],
      usages: [
        [-150, "mel-grafito-18", 13.5, 1, 1.5, 60_000],
        [-148, "fenolico", 8, 0, 2, 70_000],
        [-146, "tapacanto", 320, 30, 0, 950],
        [-146, "bisagra", 60, 0, 0, 2_300, "existing_stock"],
      ],
      products: [
        ["itm-0987-barra", "Barra de atención", 1, 1, [["carpinteria_madera", 45, 1]]],
        ["itm-0987-estantes", "Estantería de exhibición", 6, 6, [["carpinteria_madera", 35, 1]]],
      ],
      work: [
        [-165, "op-juan", "itm-0987-barra", "carpinteria_madera", 45, 50, 14_000],
        [-165, "op-diego", "itm-0987-estantes", "carpinteria_madera", 35, 40, 14_000],
      ],
      costs: [
        [-135, "outsourcing", "Laqueado barra — Taller Colores", 300_000, "Taller Colores"],
        [-128, "logistics", "Flete a Recoleta", 220_000],
        [-125, "installation", "Instalación en local (3 días)", 480_000],
        [-127, "unexpected", "Ajuste de medidas en obra", 150_000],
      ],
    }),
  );

  projects.push(
    b.project({
      id: "p-0995",
      code: "P-0995",
      name: "Oficinas Catalinas – Puestos de trabajo",
      client: "Grupo Andino",
      projectType: "Oficinas corporativas",
      description: "40 puestos operativos con cajoneras y paneles divisorios.",
      status: "completed",
      start: -140,
      due: -90,
      closedAt: -88,
      salesPrice: 14_000_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mel-blanca-18", 50, 46_000],
          ["perfil-alu", 80, 14_000],
          ["corredera", 80, 11_000],
          ["tapacanto", 900, 900],
        ],
        labor: [180, 13_000],
        direct: { transport: 350_000, montaje: 900_000, contingency: 400_000 },
      },
      purchases: [
        [-130, "mel-blanca-18", 52, 46_000, "Placas del Plata"],
        [-130, "perfil-alu", 85, 14_500, "Aluminios BA"],
        [-130, "corredera", 80, 11_000, "Herrajes Sur"],
        [-130, "tapacanto", 900, 900, "Herrajes Sur"],
      ],
      usages: [
        [-120, "mel-blanca-18", 50, 1.5, 0.5, 46_000],
        [-118, "perfil-alu", 80, 3, 2, 14_500],
        [-116, "corredera", 80, 0, 0, 11_000],
        [-115, "tapacanto", 860, 40, 0, 900],
      ],
      products: [
        ["itm-0995-puestos", "Puesto operativo", 40, 40, [["carpinteria_madera", 110, 2]]],
        ["itm-0995-paneles", "Panel divisorio", 40, 40, [["carpinteria_madera", 70, 1]]],
      ],
      work: [
        [-135, "op-juan", "itm-0995-puestos", "carpinteria_madera", 100, 100, 13_000],
        [-135, "op-diego", "itm-0995-paneles", "carpinteria_madera", 80, 90, 13_000],
      ],
      costs: [
        [-95, "logistics", "Fletes (2 viajes)", 340_000],
        [-90, "installation", "Instalación en oficinas", 880_000],
        [-92, "unexpected", "Paneles extra solicitados", 200_000],
      ],
    }),
  );

  projects.push(
    b.project({
      id: "p-1003",
      code: "P-1003",
      name: "Exhibidores Farmacia Norte",
      client: "Farmacias del Norte",
      projectType: "Exhibidores",
      description: "12 exhibidores de góndola para cadena de farmacias.",
      status: "completed",
      start: -110,
      due: -75,
      closedAt: -73,
      salesPrice: 3_800_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mdf-18", 12, 75_000],
          ["perfil-alu", 24, 14_000],
        ],
        labor: [60, 13_000],
        direct: { bought: 250_000, transport: 120_000, contingency: 94_000 },
      },
      purchases: [
        [-105, "mdf-18", 14, 78_000, "Placas del Plata"],
        [-105, "perfil-alu", 24, 14_500, "Aluminios BA"],
      ],
      usages: [
        [-98, "mdf-18", 13, 1, 0, 78_000],
        [-96, "perfil-alu", 23, 1, 0, 14_500],
      ],
      products: [["itm-1003-exhib", "Exhibidor de góndola", 12, 12, [["carpinteria_madera", 60, 1]]]],
      work: [[-104, "op-juan", "itm-1003-exhib", "carpinteria_madera", 60, 66, 13_000]],
      costs: [
        [-85, "outsourcing", "Pintura poliuretánica", 270_000],
        [-78, "logistics", "Envío a sucursales", 150_000],
      ],
    }),
  );

  projects.push(
    b.project({
      id: "p-1011",
      code: "P-1011",
      name: "Local Unicenter – Mobiliario",
      client: "Moda Urbana",
      projectType: "Local comercial",
      description: "Mostrador, probadores y exhibidores murales para local de indumentaria.",
      status: "completed",
      start: -95,
      due: -50,
      closedAt: -47,
      salesPrice: 10_500_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mel-blanca-18", 30, 48_000],
          ["mdf-18", 10, 78_000],
          ["perfil-alu", 50, 15_000],
          ["tapacanto", 500, 950],
        ],
        labor: [130, 14_000],
        direct: { bought: 450_000, transport: 250_000, montaje: 600_000, contingency: 300_000 },
      },
      purchases: [
        [-88, "mel-blanca-18", 34, 48_000, "Placas del Plata"],
        [-88, "mdf-18", 12, 82_000, "Placas del Plata"],
        [-88, "perfil-alu", 56, 15_500, "Aluminios BA"],
        [-88, "tapacanto", 550, 950, "Herrajes Sur"],
      ],
      usages: [
        [-80, "mel-blanca-18", 31, 2, 1, 48_000],
        [-78, "mdf-18", 11.5, 0.5, 0, 82_000],
        [-76, "perfil-alu", 53, 3, 0, 15_500],
        [-75, "tapacanto", 500, 50, 0, 950],
      ],
      products: [
        ["itm-1011-mostrador", "Mostrador", 1, 1, [["carpinteria_madera", 40, 1]]],
        ["itm-1011-probadores", "Probador", 4, 4, [["carpinteria_madera", 40, 1]]],
        ["itm-1011-murales", "Exhibidor mural", 6, 6, [["carpinteria_madera", 50, 1]]],
      ],
      work: [
        [-90, "op-juan", "itm-1011-mostrador", "carpinteria_madera", 40, 45, 14_000],
        [-90, "op-juan", "itm-1011-probadores", "carpinteria_madera", 40, 40, 14_000],
        [-90, "op-diego", "itm-1011-murales", "carpinteria_madera", 50, 62, 14_000],
      ],
      costs: [
        [-65, "outsourcing", "Vidrios templados", 480_000, "Vidriería Central"],
        [-55, "logistics", "Flete a Unicenter", 250_000],
        [-50, "installation", "Instalación nocturna en shopping", 820_000],
        [-52, "unexpected", "Rehacer mostrador por cambio de cliente", 260_000],
      ],
    }),
  );

  // ── Proyecto demo principal ──
  projects.push(
    b.project({
      id: MAIN_DEMO_PROJECT_ID,
      code: "P-1042",
      name: "Local Palermo – Mobiliario comercial",
      client: "Retail Sur",
      projectType: "Local comercial",
      description: "Mobiliario completo para local a la calle: mostrador, góndolas, exhibidores murales y depósito.",
      status: "production",
      start: -40,
      due: 20,
      salesPrice: 12_000_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mel-blanca-18", 10, 50_000],
          ["mel-grafito-18", 16, 62_500],
          ["mdf-18", 5, 80_000],
          ["perfil-alu", 60, 15_000],
          ["bisagra", 120, 2_500],
          ["corredera", 40, 12_500],
          ["tapacanto", 400, 1_000],
        ],
        labor: [100, 15_000],
        direct: { bought: 600_000, transport: 300_000, montaje: 500_000, contingency: 300_000 },
      },
      purchases: [
        [-34, "mel-blanca-18", 12, 50_000, "Placas del Plata"],
        [-34, "mel-grafito-18", 20, 65_000, "Placas del Plata"],
        [-33, "mdf-18", 8, 86_000, "Maderera Oeste"],
        [-33, "perfil-alu", 72, 16_000, "Aluminios BA"],
        [-32, "corredera", 40, 13_000, "Herrajes Sur"],
        [-32, "tapacanto", 510, 1_060, "Herrajes Sur"],
      ],
      usages: [
        [-25, "mel-blanca-18", 5, 0, 0, 50_000],
        [-22, "mel-grafito-18", 10, 1, 0, 65_000],
        [-20, "mdf-18", 4, 0, 0, 86_000],
        [-18, "perfil-alu", 40, 2, 0, 16_000],
        [-15, "tapacanto", 250, 30, 0, 1_060],
        [-12, "bisagra", 118, 2, 0, 2_500, "existing_stock"],
        [-12, "corredera", 40, 0, 0, 13_000],
        [-8, "mel-blanca-18", 4, 1, 2, 50_000],
        [-6, "mel-grafito-18", 7, 1, 1, 65_000],
        [-4, "mdf-18", 3, 0.5, 0.5, 86_000],
        [-3, "perfil-alu", 26, 2, 2, 16_000],
        [-2, "tapacanto", 190, 30, 0, 1_060],
      ],
      products: [
        ["itm-mostrador", "Mostrador de atención", 1, 1, [["carpinteria_madera", 30, 1]]],
        ["itm-gondolas", "Góndola central", 6, 4, [["carpinteria_madera", 40, 2]]],
        ["itm-murales", "Exhibidor mural", 8, 2, [["carpinteria_madera", 30, 1]]],
      ],
      work: [
        [-38, "op-juan", "itm-mostrador", "carpinteria_madera", 28, 28],
        [-36, "op-diego", "itm-gondolas", "carpinteria_madera", 16, 16],
        [-30, "op-juan", "itm-gondolas", "carpinteria_madera", 16, 14],
        [-20, "op-juan", "itm-murales", "carpinteria_madera", 16, 16],
      ],
      costs: [
        [-9, "outsourcing", "Laqueado de frentes — Taller Colores", 750_000, "Taller Colores"],
        [-7, "logistics", "Flete de placas y traslado a obra", 350_000],
        [-6, "unexpected", "Reposición de frente dañado", 120_000],
      ],
    }),
  );

  projects.push(
    b.project({
      id: "p-1045",
      code: "P-1045",
      name: "Oficinas Núñez – Puestos operativos",
      client: "Estudio Lumen",
      projectType: "Oficinas corporativas",
      description: "24 puestos de trabajo, 2 salas de reunión y guardado.",
      status: "production",
      start: -20,
      due: 30,
      salesPrice: 11_000_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mel-blanca-18", 36, 50_000],
          ["perfil-alu", 50, 15_000],
          ["corredera", 48, 12_500],
          ["tapacanto", 600, 1_000],
        ],
        labor: [150, 14_000],
        hours: { design: [16, 27_000], admin: [8, 27_000] },
        direct: { transport: 300_000, montaje: 700_000, contingency: 350_000 },
      },
      purchases: [
        [-18, "mel-blanca-18", 36, 50_000, "Placas del Plata"],
        [-18, "perfil-alu", 50, 15_000, "Aluminios BA"],
        [-17, "tapacanto", 600, 1_000, "Herrajes Sur"],
      ],
      usages: [
        [-12, "mel-blanca-18", 18, 0.5, 0, 50_000],
        [-6, "perfil-alu", 22, 0.5, 0, 15_000],
        [-3, "tapacanto", 260, 15, 0, 1_000],
      ],
      products: [
        ["itm-1045-puestos", "Puesto de trabajo", 24, 10, [["carpinteria_madera", 100, 2]]],
        ["itm-1045-guardado", "Mueble de guardado", 6, 0, [["carpinteria_madera", 50, 1]]],
      ],
      work: [
        [-19, "op-juan", "itm-1045-puestos", "carpinteria_madera", 24, 24],
        [-19, "op-diego", "itm-1045-puestos", "carpinteria_madera", 24, 22],
      ],
      costs: [
        [-15, "other", "Planos de taller y renders", 486_000, "Estudio Línea", "design"],
        [-10, "other", "Gestión de compras y permisos", 162_000, undefined, "admin"],
      ],
    }),
  );

  projects.push(
    b.project({
      id: "p-1048",
      code: "P-1048",
      name: "Exhibidores Córdoba – Cadena regional",
      client: "Distribuidora Mediterránea",
      projectType: "Exhibidores",
      description: "30 exhibidores de punto de venta para 10 sucursales.",
      status: "production",
      start: -28,
      due: 12,
      salesPrice: 6_600_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mdf-18", 20, 80_000],
          ["perfil-alu", 40, 15_000],
          ["tapacanto", 300, 1_000],
        ],
        labor: [70, 14_000],
        direct: { bought: 380_000, transport: 400_000, contingency: 140_000 },
      },
      purchases: [
        [-25, "mdf-18", 22, 82_000, "Maderera Oeste"],
        [-25, "perfil-alu", 40, 15_000, "Aluminios BA"],
      ],
      usages: [
        [-18, "mdf-18", 12, 1, 0, 82_000],
        [-8, "mdf-18", 8, 1, 0, 82_000],
        [-8, "perfil-alu", 30, 1, 0, 15_000],
        [-7, "tapacanto", 240, 20, 0, 1_000, "existing_stock"],
      ],
      products: [["itm-1048-exhib", "Exhibidor de punto de venta", 30, 18, [["carpinteria_madera", 70, 2]]]],
      work: [
        [-27, "op-juan", "itm-1048-exhib", "carpinteria_madera", 24, 24],
        [-27, "op-diego", "itm-1048-exhib", "carpinteria_madera", 24, 24],
      ],
      costs: [[-5, "outsourcing", "Pintura epoxi — primera tanda", 300_000]],
    }),
  );

  projects.push(
    b.project({
      id: "p-1039",
      code: "P-1039",
      name: "Recepción Puerto Madero",
      client: "Torre Dock Corporativo",
      projectType: "Recepción",
      description: "Mostrador de recepción, revestimiento mural y banco de espera.",
      status: "installation",
      start: -45,
      due: 3,
      salesPrice: 9_600_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mdf-18", 18, 80_000],
          ["mel-grafito-18", 12, 62_500],
          ["perfil-alu", 30, 15_000],
        ],
        labor: [110, 14_000],
        direct: { bought: 900_000, transport: 250_000, montaje: 600_000, contingency: 310_000 },
      },
      purchases: [
        [-40, "mdf-18", 18, 80_000, "Maderera Oeste"],
        [-40, "mel-grafito-18", 12, 62_500, "Placas del Plata"],
        [-40, "perfil-alu", 30, 15_000, "Aluminios BA"],
      ],
      usages: [
        [-30, "mdf-18", 17, 1, 0, 80_000],
        [-28, "mel-grafito-18", 11, 0.5, 0.5, 62_500],
        [-25, "perfil-alu", 28, 1, 1, 15_000],
      ],
      products: [
        ["itm-1039-mostrador", "Mostrador de recepción", 1, 1, [["carpinteria_madera", 60, 1]]],
        ["itm-1039-banco", "Banco de espera", 2, 2, [["carpinteria_madera", 30, 1]]],
        ["itm-1039-mural", "Revestimiento mural", 1, 0, [["carpinteria_madera", 20, 1]]],
      ],
      work: [
        [-44, "op-juan", "itm-1039-mostrador", "carpinteria_madera", 56, 56],
        [-44, "op-diego", "itm-1039-banco", "carpinteria_madera", 24, 24],
        [-12, "op-marcos", "itm-1039-mural", "carpinteria_madera", 16, 12],
      ],
      costs: [
        [-15, "outsourcing", "Laqueado y enchapado", 960_000, "Taller Colores"],
        [-4, "logistics", "Flete a Puerto Madero", 230_000],
        [-2, "installation", "Instalación — día 1 y 2", 380_000],
      ],
    }),
  );

  projects.push(
    b.project({
      id: "p-1047",
      code: "P-1047",
      name: "Pop-up Abasto – Stand temporal",
      client: "Marca Sónica",
      projectType: "Stand",
      description: "Stand pop-up de 30 m² para lanzamiento de producto (armado y desarme).",
      status: "production",
      start: -22,
      // Atrasado a propósito: la entrega venció y el stand todavía no está terminado.
      due: -2,
      salesPrice: 4_500_000,
      owner: MGMT,
      budget: {
        materials: [
          ["fenolico", 6, 70_000],
          ["mdf-18", 8, 80_000],
          ["perfil-alu", 20, 15_000],
        ],
        labor: [50, 14_000],
        direct: { bought: 450_000, transport: 200_000, montaje: 300_000, contingency: 110_000 },
      },
      purchases: [
        [-20, "fenolico", 4, 72_000, "Maderera Oeste"],
        [-20, "mdf-18", 8, 82_000, "Maderera Oeste"],
      ],
      usages: [
        [-16, "fenolico", 2, 0, 0, 70_000, "reused_leftover"],
        [-15, "fenolico", 4, 0, 0, 72_000],
        [-12, "mdf-18", 5, 0.5, 0, 82_000],
      ],
      products: [
        ["itm-1047-stand", "Stand pop-up 30 m²", 1, 0, [["carpinteria_madera", 40, 2]]],
        ["itm-1047-mostrador", "Mostrador de demostración", 2, 2, [["carpinteria_madera", 10, 1]]],
      ],
      work: [
        [-21, "op-lucia", "itm-1047-mostrador", "carpinteria_madera", 10, 9],
        [-21, "op-marcos", "itm-1047-stand", "carpinteria_madera", 24, 24],
      ],
      costs: [[-10, "outsourcing", "Impresión y ploteo de gráfica", 520_000, "Gráfica Rápida"]],
    }),
  );

  // ── Proyecto estrella de la demo: atraviesa los 4 roles ──
  // Mesas terminadas (con Juan pasado de horas en carpintería → alerta), sillas en producción (40/100),
  // compras en distintos estados y un rubro de las sillas sin operario asignado.
  projects.push(
    b.project({
      id: STAR_PROJECT_ID,
      code: "P-1058",
      name: "Restaurante Costanera – 10 mesas y 100 sillas",
      client: "Grupo Costanera",
      projectType: "Mobiliario gastronómico",
      description: "10 mesas de comedor y 100 sillas apilables para el salón del restaurante.",
      status: "production",
      start: -20,
      due: 25,
      salesPrice: 16_000_000,
      owner: MGMT,
      budget: {
        materials: [
          ["multilaminado-18", 20, 95_000],
          ["cano-40", 300, 9_000],
          ["tapacanto", 200, 1_000],
        ],
        laborRubros: [
          ["carpinteria_madera", 280, 15_000, 2],
          ["carpinteria_metalica", 80, 14_000, 1],
          ["embalaje", 26, 11_000, 1],
        ],
        direct: { bought: 600_000, transport: 400_000, contingency: 300_000 },
      },
      // Las compras de este proyecto salen de órdenes de compra (seedOrders): OC-0001, OC-0002 y OC-0003.
      products: [
        ["itm-mesas", "Mesa de comedor", 10, 10, [["carpinteria_madera", 60, 2], ["carpinteria_metalica", 20, 1], ["embalaje", 6, 1]]],
        ["itm-sillas", "Silla apilable", 100, 40, [["carpinteria_madera", 220, 2], ["carpinteria_metalica", 60, 1], ["embalaje", 20, 1]]],
      ],
      work: [
        [-18, "op-juan", "itm-mesas", "carpinteria_madera", 30, 44],
        [-18, "op-diego", "itm-mesas", "carpinteria_madera", 30, 30],
        [-18, "op-marcos", "itm-mesas", "carpinteria_metalica", 20, 20],
        [-8, "op-lucia", "itm-mesas", "embalaje", 6, 6],
        [-12, "op-diego", "itm-sillas", "carpinteria_madera", 48, 46],
        [-8, "op-marcos", "itm-sillas", "carpinteria_metalica", 24, 24],
      ],
      costs: [[-6, "outsourcing", "Laqueado de tapas de mesa — Taller Colores", 560_000, "Taller Colores"]],
    }),
  );

  projects.push(
    b.project({
      id: "p-1051",
      code: "P-1051",
      name: "Mobiliario Nordelta – Casa modelo",
      client: "Desarrollos Nordelta",
      projectType: "Mobiliario residencial",
      description: "Placares, vanitory y mueble de TV para unidad modelo.",
      status: "approved",
      start: 5,
      due: 45,
      salesPrice: 7_500_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mel-blanca-18", 24, 50_000],
          ["mel-grafito-18", 10, 62_500],
          ["bisagra", 80, 2_500],
          ["corredera", 30, 12_500],
          ["tapacanto", 350, 1_000],
        ],
        labor: [90, 14_000],
        hours: { design: [10, 27_000], admin: [6, 27_000] },
        direct: { transport: 200_000, montaje: 400_000, contingency: 250_000 },
      },
      products: [
        ["itm-1051-placard", "Placard", 3, 0, [["carpinteria_madera", 50, 2]]],
        ["itm-1051-vanitory", "Vanitory", 1, 0, [["carpinteria_madera", 15, 1]]],
        ["itm-1051-tv", "Mueble de TV", 1, 0, [["carpinteria_madera", 25, 1]]],
      ],
    }),
  );

  projects.push(
    b.project({
      id: "p-1053",
      code: "P-1053",
      name: "Showroom Belgrano",
      client: "Deco Hogar",
      projectType: "Local comercial",
      description: "Showroom de 120 m²: exhibidores de cocina modelo, mostrador y estanterías.",
      status: "purchasing",
      start: -5,
      due: 40,
      salesPrice: 13_500_000,
      owner: MGMT,
      budget: {
        materials: [
          ["mel-blanca-18", 30, 50_000],
          ["mel-grafito-18", 20, 62_500],
          ["mdf-18", 10, 80_000],
          ["perfil-alu", 60, 15_000],
          ["corredera", 60, 12_500],
        ],
        labor: [140, 14_000],
        direct: { bought: 500_000, transport: 350_000, montaje: 700_000, contingency: 390_000 },
      },
      purchases: [
        [-3, "mel-blanca-18", 32, 51_000, "Placas del Plata"],
        [-3, "mel-grafito-18", 22, 63_000, "Placas del Plata"],
        [-2, "mdf-18", 10, 84_000, "Maderera Oeste"],
      ],
      products: [
        ["itm-1053-cocina", "Cocina modelo", 2, 0, [["carpinteria_madera", 80, 2]]],
        ["itm-1053-mostrador", "Mostrador", 1, 0, [["carpinteria_madera", 30, 1]]],
        ["itm-1053-estantes", "Estantería", 6, 0, [["carpinteria_madera", 30, 1]]],
      ],
    }),
  );

  projects.push(
    b.project({
      id: "p-1056",
      code: "P-1056",
      name: "Stand Expo Madera 2026",
      client: "Cámara Maderera Regional",
      projectType: "Stand",
      description: "Stand institucional de 50 m² para feria sectorial.",
      status: "quotation",
      start: 25,
      due: 55,
      salesPrice: 5_600_000,
      owner: MGMT,
      budget: {
        materials: [
          ["fenolico", 10, 70_000],
          ["mdf-18", 8, 80_000],
          ["perfil-alu", 30, 15_000],
        ],
        labor: [60, 14_000],
        hours: { design: [12, 27_000], admin: [4, 27_000] },
        direct: { bought: 400_000, transport: 250_000, montaje: 350_000, contingency: 150_000 },
      },
      products: [["itm-1056-stand", "Stand institucional 50 m²", 1, 0, [["carpinteria_madera", 60, 2]]]],
    }),
  );

  // Bitácora del proyecto demo principal.
  const main = projects.find((x) => x.id === MAIN_DEMO_PROJECT_ID);
  if (main) {
    const logs: StageLog[] = [
      { id: "log-0001", projectId: main.id, stage: "purchasing", date: b.day(-34), kind: "note", text: "Se compraron las placas y los herrajes con el proveedor habitual. El tapacanto se pidió con 10% extra por la merma anterior.", responsible: MGMT, createdBy: MGMT, createdAt: b.at(-34, 13) },
      { id: "log-0002", projectId: main.id, stage: "production", date: b.day(-22), kind: "incident", text: "Una placa de melamina grafito llegó con una esquina golpeada. Se usó igual en piezas chicas y se informó al proveedor.", responsible: PLANTA, createdBy: PLANTA, createdAt: b.at(-22, 16) },
      { id: "log-0003", projectId: main.id, stage: "production", date: b.day(-10), kind: "note", text: "Terminado el corte de las góndolas. Arranca el armado del mostrador.", responsible: PLANTA, itemId: "itm-gondolas", createdBy: PLANTA, createdAt: b.at(-10, 17) },
    ];
    main.stageLogs = logs;
  }
  const shop = projects.find((x) => x.id === "p-1053");
  if (shop) {
    shop.stageLogs = [
      { id: "log-0004", projectId: shop.id, stage: "purchasing", date: b.day(-3), kind: "note", text: "Compra de placas realizada. Falta cotizar los herrajes y las correderas.", responsible: MGMT, createdBy: MGMT, createdAt: b.at(-3, 14) },
    ];
  }

  const operators: Operator[] = OPERATOR_SPECS.map((o) => ({ ...o, active: true, createdAt: b.at(-200, 9) }));
  for (const [off, operatorId, projectId, itemId, rubro, hours] of UPCOMING) {
    b.assignment(projectId, itemId, rubro, operatorId, off, hours);
    const project = projects.find((x) => x.id === projectId);
    if (project && !project.assignedOperatorIds.includes(operatorId)) project.assignedOperatorIds = [...project.assignedOperatorIds, operatorId];
  }
  const assignments = b.assignments;
  const ledger = deriveLedgerFromLegacy(projects, b.pool);
  const { orders, stock } = seedOrders(b, projects, ledger);
  return { projects, operators, assignments, orders, stock, legacyPool: b.pool };
}

/**
 * Órdenes de compra del proyecto estrella (Lote 6), con su historia coherente:
 *  - OC-0001 Maderera Oeste: multilaminado. Facturada, pagada y recibida (ya se consumió una parte).
 *  - OC-0002 Hierros Sur: caño. Facturada a $10.500 contra $9.000 estimado (alerta), sin pagar, recibida en parte.
 *  - OC-0003 Herrajes Sur: tapacanto. Borrador.
 */
function seedOrders(b: SeedBuilder, projects: Project[], ledger: StockState): { orders: PurchaseOrder[]; stock: StockState } {
  const star = projects.find((p) => p.id === STAR_PROJECT_ID);
  if (!star) return { orders: [], stock: ledger };
  const lineOf = (materialId: string) => {
    const l = star.budgetLines.find((x) => x.category === "materials" && x.materialId === materialId);
    if (!l) throw new Error(`Seed: falta ${materialId} en ${star.code}`);
    return l;
  };
  const line = (id: string, materialId: string, quantity: number, unitCost: number, received: number): PurchaseOrderLine => {
    const l = lineOf(materialId);
    return { id, projectId: star.id, budgetLineId: l.id, materialId, materialName: l.description, unit: l.unit, quantity, unitCost, receivedQuantity: received };
  };
  const order = (n: number, supplier: string, day: number, status: PurchaseOrder["status"], lines: PurchaseOrderLine[], extra: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
    id: `oc-demo-${n}`,
    number: `OC-${String(n).padStart(4, "0")}`,
    supplier,
    date: b.day(day),
    status,
    paid: false,
    received: receivedState(lines),
    lines,
    createdBy: DEMO_USERS.compras.name,
    createdAt: b.at(day, 11),
    ...extra,
  });
  const orders = [
    order(1, "Maderera Oeste", -18, "invoiced", [line("ocl-demo-1", "multilaminado-18", 20, 98_000, 20)], {
      invoiceNumber: "A-0003-00012841",
      invoiceAmount: 1_960_000,
      invoiceDate: b.day(-17),
      paid: true,
    }),
    order(2, "Hierros Sur", -16, "invoiced", [line("ocl-demo-2", "cano-40", 300, 10_500, 180)], {
      invoiceNumber: "B-0001-00004410",
      invoiceAmount: 3_150_000,
      invoiceDate: b.day(-14),
    }),
    order(3, "Herrajes Sur", -1, "draft", [line("ocl-demo-3", "tapacanto", 200, 1_050, 0)]),
  ];
  const ctx = { actor: DEMO_USERS.compras.name, now: b.at(-1, 12) };
  // OC-0001: la factura (compra real) y el lote recibido; después se usó una parte en las mesas.
  const inv1 = invoiceEntries(orders[0], { invoiceNumber: orders[0].invoiceNumber ?? "", invoiceAmount: 1_960_000, invoiceDate: b.day(-17) }, ctx.actor, b.at(-17, 12));
  const inv2 = invoiceEntries(orders[1], { invoiceNumber: orders[1].invoiceNumber ?? "", invoiceAmount: 3_150_000, invoiceDate: b.day(-14) }, ctx.actor, b.at(-14, 12));
  star.purchaseEntries = [...star.purchaseEntries, ...inv1, ...inv2];
  star.activity = [
    ...orders.slice(0, 2).flatMap((o, i) => invoiceActivity(o, star.id, o.invoiceNumber ?? "", ctx.actor, b.at(i === 0 ? -17 : -14, 12), (k) => `act-oc-${i}-${k}`)),
    ...star.activity,
  ].sort((x, y) => y.at.localeCompare(x.at));
  let stock = ledger;
  for (const o of orders.slice(0, 2)) {
    const pending = { ...o, lines: o.lines.map((l) => ({ ...l, receivedQuantity: 0 })), received: "no" as const };
    const res = receiveOrder(pending, o.lines.map((l) => ({ lineId: l.id, quantity: l.receivedQuantity })), projects, { ...ctx, today: b.day(o === orders[0] ? -16 : -12) });
    // Ids estables (la demo se deriva igual siempre): un lote y un movimiento por línea recibida.
    const ids = new Map(res.sent.map((x) => [x.lot_id, x.line_id]));
    const lotId = (id: string) => `lot-${ids.get(id) ?? id}`;
    stock = applyChange(stock, {
      lots: res.change.lots.map((l) => ({ ...l, id: lotId(l.id), createdAt: b.at(-12, 10) })),
      movements: res.change.movements.map((m) => ({ ...m, id: `mov-${ids.get(m.lotId) ?? m.id}`, lotId: lotId(m.lotId), createdAt: b.at(-12, 10) })),
    });
  }
  // Consumo de multilaminado en las mesas (sale del lote de OC-0001): el mismo registro que carga el taller.
  const mat = material("multilaminado-18");
  const used = registerUsage(
    star,
    stock,
    { materialId: mat.id, materialName: mat.name, unit: mat.unit, consumed: 8, waste: 0.5, date: b.day(-12), itemId: "itm-mesas" },
    DEFAULT_SETTINGS,
    { actor: PLANTA, now: b.at(-12, 15), role: "owner" },
  );
  // Ids estables también para el consumo (movimientos y lo que el proyecto referencia de ellos).
  const known = new Set(stock.movements.map((m) => m.id));
  let json = JSON.stringify({ project: used.project, stock: used.stock });
  used.stock.movements.filter((m) => !known.has(m.id)).forEach((m, i) => {
    json = json.split(`"${m.id}"`).join(`"mov-uso-${i + 1}"`);
  });
  const stable = JSON.parse(json) as { project: Project; stock: StockState };
  projects[projects.indexOf(star)] = stable.project;
  stock = stable.stock;
  return { orders, stock };
}
