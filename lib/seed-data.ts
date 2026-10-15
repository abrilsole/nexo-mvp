// ─────────────────────────────────────────────────────────────
// Datos demo — empresa ficticia Madera Sur S.R.L.
// Las fechas se generan relativas a "hoy" para que las alertas de
// fechas / registros tengan sentido cada vez que se resetea la demo.
// Ningún nombre corresponde a empresas o clientes reales.
// ─────────────────────────────────────────────────────────────
import type {
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
import { ACTUAL_TYPE_LABELS, DEMO_USERS, MATERIAL_CATALOG, STATUS_LABELS, STATUS_ORDER, type OtherCostCategory } from "./constants";
import { actualInputCategory } from "./project-operations";
import { budgetLineTotal } from "./calculations";
import { toISODate } from "./formatting";
import { activityTimeline, actualMessage, leftoverMessage, purchaseMessage, usageMessage } from "./activity";
import { applyUsageToPool, poolAvailableFor } from "./reusable-pool";
import { deriveLedgerFromLegacy } from "./stock-legacy";
import type { StockState } from "./stock";

const MGMT = DEMO_USERS.admin.name;
const PLANTA = DEMO_USERS.jefe_planta.name;

interface BudgetSpec {
  materials: Array<[materialId: string, qty: number, unitCost: number]>;
  labor?: [hours: number, rate: number];
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
type LaborSpec = [dayOffset: number, role: string, worker: string, hours: number, rate: number];
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
  labor?: LaborSpec[];
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
  { id: "op-sofia", name: "Sofía Méndez", role: "Oficina técnica", hourlyCost: 15_000 },
];

function operatorIdFor(name: string): string | undefined {
  return OPERATOR_SPECS.find((o) => o.name === name)?.id;
}

class SeedBuilder {
  private seq = 0;
  pool: ReusableMaterial[] = [];
  constructor(private readonly now: Date) {}

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
      items: [],
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

    for (const [off, role, worker, hours, rate] of spec.labor ?? []) {
      const e: ActualEntry = {
        id: this.id("act"),
        projectId: p.id,
        date: this.day(off),
        type: "labor",
        category: "labor",
        description: `${role} — ${worker}`,
        amount: hours * rate,
        labor: { role, workerName: worker, hours, hourlyCost: rate },
        operatorId: operatorIdFor(worker),
        createdBy: worker,
        createdAt: this.at(off, 18),
      };
      p.actualEntries.push(e);
      ev(off, "cost", worker, actualMessage(e), 18);
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
    // Operarios asignados: los que ya cargaron horas + el equipo base en obras abiertas.
    const worked = new Set((p.actualEntries.map((e) => e.operatorId).filter(Boolean)) as string[]);
    const open = ["purchasing", "production", "installation"].includes(spec.status);
    if (open) {
      worked.add("op-juan");
      worked.add("op-diego");
    }
    p.assignedOperatorIds = OPERATOR_SPECS.map((o) => o.id).filter((id) => worked.has(id));
    return p;
  }
}

export interface SeedState {
  projects: Project[];
  operators: Operator[];
  /** Stock inicial: se deriva de las compras, usos y sobrantes de la demo. */
  stock: StockState;
  /** Pool del modelo anterior (sólo para derivar el stock). */
  legacyPool: ReusableMaterial[];
}

export const MAIN_DEMO_PROJECT_ID = "p-1042";

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
      labor: [
        [-150, "Carpintería", "Juan Pérez", 50, 14_000],
        [-140, "Armado", "Diego Sosa", 40, 14_000],
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
      labor: [
        [-120, "Carpintería", "Juan Pérez", 100, 13_000],
        [-110, "Armado", "Diego Sosa", 90, 13_000],
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
      labor: [[-95, "Carpintería", "Juan Pérez", 66, 13_000]],
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
      labor: [
        [-80, "Carpintería", "Juan Pérez", 85, 14_000],
        [-70, "Armado", "Diego Sosa", 62, 14_000],
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
      labor: [
        [-24, "Oficina técnica", "Sofía Méndez", 20, 15_000],
        [-20, "Carpintería", "Juan Pérez", 30, 15_000],
        [-10, "Carpintería", "Juan Pérez", 30, 15_000],
        [-5, "Armado", "Diego Sosa", 40, 12_500],
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
      labor: [
        [-12, "Carpintería", "Juan Pérez", 35, 14_000],
        [-4, "Armado", "Diego Sosa", 25, 14_000],
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
      labor: [
        [-18, "Carpintería", "Juan Pérez", 45, 14_000],
        [-6, "Armado", "Diego Sosa", 36, 14_000],
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
      labor: [
        [-30, "Carpintería", "Juan Pérez", 60, 14_000],
        [-20, "Armado", "Diego Sosa", 48, 14_000],
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
      due: 4,
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
      labor: [[-11, "Carpintería", "Juan Pérez", 24, 14_000]],
      costs: [[-10, "outsourcing", "Impresión y ploteo de gráfica", 520_000, "Gráfica Rápida"]],
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
    }),
  );

  // Muebles, bitácora y archivos del proyecto demo principal.
  const main = projects.find((x) => x.id === MAIN_DEMO_PROJECT_ID);
  if (main) {
    main.items = [
      { id: "itm-mostrador", name: "Mostrador de atención", description: "Frente laqueado, tapa de MDF y cajonera.", quantity: 1 },
      { id: "itm-gondolas", name: "Góndolas centrales", description: "Estructura de melamina y perfil de aluminio.", quantity: 6 },
      { id: "itm-murales", name: "Exhibidores murales", quantity: 8 },
    ];
    const labor = main.actualEntries.filter((e) => e.type === "labor");
    if (labor[1]) labor[1].itemId = "itm-mostrador";
    if (labor[2]) labor[2].itemId = "itm-gondolas";
    if (labor[3]) labor[3].itemId = "itm-gondolas";
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
  return { projects, operators, stock: deriveLedgerFromLegacy(projects, b.pool), legacyPool: b.pool };
}
