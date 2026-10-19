// ─────────────────────────────────────────────────────────────
// Operaciones de dominio sobre proyectos — funciones puras.
// El store solo orquesta: llama a estas funciones y guarda el resultado.
// Esto permite testear los escenarios de la demo sin UI.
// ─────────────────────────────────────────────────────────────
import type {
  ActivityEvent,
  ActualEntry,
  ActualEntryType,
  AlertSettings,
  AppRole,
  Attachment,
  BudgetCategory,
  BudgetLine,
  LeftoverDims,
  MaterialSource,
  MaterialUsageEntry,
  Operator,
  Project,
  ProjectBaseline,
  ProjectItem,
  ProjectStatus,
  PurchaseEntry,
  StageKey,
  StageLog,
  StockLot,
  UnitCostOrigin,
  WorkAssignment,
} from "@/types";
import {
  ACTUAL_TYPE_LABELS,
  ACTUAL_TYPE_TO_CATEGORY,
  BUDGET_EDITABLE_STATUSES,
  CATEGORY_IS_PLURAL,
  CATEGORY_LABELS,
  type OtherCostCategory,
  STATUS_LABELS,
} from "./constants";
import { actualByCategory, budgetByCategory, budgetLineTotal, budgetTotal } from "./calculations";
import { actualMessage, activity, createId, leftoverMessage, purchaseMessage, usageMessage } from "./activity";
import { categoryAlertLevel, LEVEL_RANK } from "./alerts";
import { formatPercent, formatQty, todayISO } from "./formatting";
import { materialKey } from "./material-reconciliation";
import { productInputError, type ProductInput } from "./production";
import { rubroDef } from "./rubros";
import { unresolvedMaterial } from "./material-flow";
import { assertExecutable, assertTransition, checkHours, isManager, RuleError } from "./project-rules";
import {
  applyChange,
  assignToProject,
  markLeftover,
  receiveStock,
  releaseToWarehouse,
  returnToSupplier,
  transferBetweenProjects,
  consumeMaterial,
  type StockState,
} from "./stock";

export class DomainError extends Error {}

export interface Ctx {
  actor: string;
  now: string; // ISO datetime
  /** Rol de quien opera. Por defecto Gestión. */
  role?: AppRole;
  /** Operario vinculado al usuario (sólo rol operator). */
  operatorId?: string;
}

const roleOf = (ctx: Ctx): AppRole => ctx.role ?? "owner";

function assertManager(ctx: Ctx, what: string) {
  if (!isManager(roleOf(ctx))) throw new RuleError(`${what} lo hace un usuario Administrativo.`);
}


/** Un operario sólo trabaja en proyectos que tiene asignados. */
function assertCanWork(project: Pick<Project, "assignedOperatorIds">, ctx: Ctx) {
  if (roleOf(ctx) !== "operator") return;
  if (!ctx.operatorId || !project.assignedOperatorIds.includes(ctx.operatorId)) {
    throw new RuleError("No estás asignado a este proyecto.");
  }
}

function touch(project: Project, now: string, events: ActivityEvent[]): Project {
  return { ...project, updatedAt: now, activity: [...events, ...project.activity] };
}

// ── Creación ──────────────────────────────────────────────────

export interface BudgetLineInput {
  category: BudgetLine["category"];
  description: string;
  materialId?: string;
  quantity: number | null;
  unit: string;
  unitCost: number;
  notes?: string;
  rubro?: BudgetLine["rubro"];
  hourRateId?: string;
  operatorId?: string;
  hourType?: BudgetLine["hourType"];
  hoursPerDay?: number;
  overtimeMultiplier?: number;
  /** Mano de obra: operarios que pidió el Cotizador (Lote 5B). */
  workers?: number;
}

export function makeBudgetLine(input: BudgetLineInput): BudgetLine {
  return { id: createId("bl"), ...input, total: budgetLineTotal(input) };
}

export interface NewProjectInput {
  code: string;
  name: string;
  client: string;
  projectType: string;
  description: string;
  startDate: string;
  dueDate: string;
  owner: string;
  salesPrice: number;
  budgetLines: BudgetLineInput[];
}

export function nextProjectCode(projects: Pick<Project, "code">[]): string {
  const max = projects.reduce((m, p) => {
    const n = Number(/^P-(\d+)$/.exec(p.code)?.[1] ?? 0);
    return Math.max(m, n);
  }, 1000);
  return `P-${max + 1}`;
}

export function createProject(input: NewProjectInput, ctx: Ctx): Project {
  return {
    id: createId("p"),
    code: input.code,
    name: input.name,
    client: input.client,
    projectType: input.projectType,
    description: input.description,
    status: "quotation",
    startDate: input.startDate,
    dueDate: input.dueDate,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    salesPrice: input.salesPrice,
    owner: input.owner,
    budgetLines: input.budgetLines.map(makeBudgetLine),
    actualEntries: [],
    materialUsages: [],
    purchaseEntries: [],
    activity: [activity("created", ctx.actor, "Proyecto creado.", ctx.now)],
    isClosed: false,
    assignedOperatorIds: [],
    items: [],
    stageLogs: [],
    attachments: [],
  };
}

// ── Presupuesto (línea base) ──────────────────────────────────

export function assertBudgetEditable(project: Project) {
  if (!BUDGET_EDITABLE_STATUSES.includes(project.status)) {
    throw new DomainError("El costo presupuestado quedó congelado al aprobar el proyecto: corregilo con un registro (Corregir).");
  }
}

export function addBudgetLine(project: Project, input: BudgetLineInput, ctx: Ctx): Project {
  assertBudgetEditable(project);
  const line = makeBudgetLine(input);
  return touch({ ...project, budgetLines: [...project.budgetLines, line] }, ctx.now, [
    activity("budget", ctx.actor, `Se agregó al costo presupuestado: ${line.description}.`, ctx.now),
  ]);
}

export function updateBudgetLine(project: Project, lineId: string, input: BudgetLineInput, ctx: Ctx): Project {
  assertBudgetEditable(project);
  return touch(
    {
      ...project,
      budgetLines: project.budgetLines.map((l) =>
        l.id === lineId ? { ...l, ...input, total: budgetLineTotal(input) } : l,
      ),
    },
    ctx.now,
    [activity("budget", ctx.actor, `Se modificó el costo presupuestado: ${input.description}.`, ctx.now)],
  );
}

export function removeBudgetLine(project: Project, lineId: string, ctx: Ctx): Project {
  assertBudgetEditable(project);
  const line = project.budgetLines.find((l) => l.id === lineId);
  return touch({ ...project, budgetLines: project.budgetLines.filter((l) => l.id !== lineId) }, ctx.now, [
    activity("budget", ctx.actor, `Se quitó del costo presupuestado: ${line?.description ?? "concepto"}.`, ctx.now),
  ]);
}

// ── Estado ────────────────────────────────────────────────────

export function captureBaseline(project: Project, ctx: Ctx): ProjectBaseline {
  return {
    capturedAt: ctx.now,
    capturedBy: ctx.actor,
    salesPrice: project.salesPrice,
    dueDate: project.dueDate,
    budgetTotal: budgetTotal(project.budgetLines),
    lines: project.budgetLines.map((l) => ({ ...l })),
  };
}

/**
 * Cambio de etapa: se avanza de a una; sólo Gestión corrige hacia atrás y con confirmación.
 * Al aprobar se congela el presupuesto original (línea base): nunca se pisa.
 */
export function changeStatus(
  project: Project,
  status: ProjectStatus,
  ctx: Ctx,
  opts: { confirmBack?: boolean } = {},
): Project {
  if (status === project.status) return project;
  const kind = assertTransition(project, status, { role: roleOf(ctx), confirmBack: opts.confirmBack });
  const msg =
    kind === "backward"
      ? `Corrección: el proyecto volvió a ${STATUS_LABELS[status]}.`
      : status === "approved"
        ? "Proyecto aprobado: el costo presupuestado queda congelado como presupuesto base."
        : `Proyecto pasó a ${STATUS_LABELS[status]}.`;
  const baseline = status === "approved" && !project.baseline ? captureBaseline(project, ctx) : project.baseline;
  return touch({ ...project, status, baseline }, ctx.now, [activity("status", ctx.actor, msg, ctx.now)]);
}

// ── Compras (NO afectan costo imputable) ──────────────────────

export interface PurchaseInput {
  materialId?: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  supplier?: string;
  date: string;
  notes?: string;
}

/**
 * Registra una compra para el proyecto: queda en el historial de compras y el material
 * entra al stock ASIGNADO al proyecto. No es costo hasta que se consuma o se desperdicie.
 */
export function addPurchase(
  project: Project,
  stock: StockState,
  input: PurchaseInput,
  ctx: Ctx,
): { project: Project; stock: StockState } {
  assertManager(ctx, "Registrar compras");
  assertOpen(project);
  if (project.status === "quotation") {
    throw new RuleError("Un proyecto en Cotización todavía no compra materiales: aprobalo primero.");
  }
  const key = materialKey(input.materialId, input.materialName);
  const entry: PurchaseEntry = {
    id: createId("pur"),
    projectId: project.id,
    ...input,
    materialId: key,
    total: Math.round(input.quantity * input.unitCost * 100) / 100,
    createdBy: ctx.actor,
    createdAt: ctx.now,
  };
  const received = receiveStock(
    {
      materialId: key,
      materialName: input.materialName,
      unit: input.unit,
      quantity: input.quantity,
      unitCost: input.unitCost,
      supplier: input.supplier,
      date: input.date,
      destination: { projectId: project.id, projectName: `${project.code} · ${project.name}` },
      purchaseEntryId: entry.id,
      notes: input.notes,
    },
    ctx,
  );
  return {
    project: touch({ ...project, purchaseEntries: [...project.purchaseEntries, entry] }, ctx.now, [
      activity("purchase", ctx.actor, purchaseMessage(entry), ctx.now),
    ]),
    stock: applyChange(stock, received),
  };
}

// ── Desvíos: evento de actividad cuando una categoría empeora de nivel ──

function deviationEvents(before: Project, after: Project, settings: AlertSettings, ctx: Ctx): ActivityEvent[] {
  const b = budgetByCategory(after.budgetLines);
  const a0 = actualByCategory(before);
  const a1 = actualByCategory(after);
  const out: ActivityEvent[] = [];
  for (const cat of Object.keys(b) as Array<keyof typeof b>) {
    if (b[cat] <= 0) continue;
    const p0 = ((a0[cat] - b[cat]) / b[cat]) * 100;
    const p1 = ((a1[cat] - b[cat]) / b[cat]) * 100;
    if (p1 <= 0) continue;
    const l0 = p0 > 0 ? LEVEL_RANK[categoryAlertLevel(p0, settings)] : -1;
    const l1 = LEVEL_RANK[categoryAlertLevel(p1, settings)];
    if (l1 > l0) {
      out.push(
        activity(
          "deviation",
          "Sistema",
          `${CATEGORY_LABELS[cat]} ${CATEGORY_IS_PLURAL[cat] ? "superaron" : "superó"} su costo presupuestado en ${formatPercent(p1, 0)}.`,
          ctx.now,
        ),
      );
    }
  }
  return out;
}

function assertOpen(project: Project) {
  if (project.isClosed) throw new DomainError("El proyecto está cerrado: no admite nuevos registros.");
}

// ── Uso de material (SÍ afecta costo imputable) ───────────────

export interface MaterialUsageInput {
  materialId: string;
  materialName: string;
  unit: string;
  consumed: number;
  waste: number;
  /** Lote puntual, si se quiere usar uno específico. Si falta se elige solo. */
  lotId?: string;
  itemId?: string;
  date: string;
  notes?: string;
  /** Opcional: lo que sobró reutilizable (no es costo, conserva su valor). */
  leftover?: {
    quantity: number;
    dims?: LeftoverDims;
    location?: string;
    destination?: "warehouse" | { projectId: string };
  };
}

function usageOrigin(lot: StockLot): UnitCostOrigin {
  return lot.kind === "leftover" ? "reusable_pool" : lot.kind === "purchase" ? "purchase" : "manual";
}

function usageSource(lot: StockLot, projectId: string): MaterialSource {
  if (lot.kind === "leftover") return "reused_leftover";
  return lot.originProjectId === projectId ? "purchased_for_project" : "existing_stock";
}

/**
 * Consumo / desperdicio de material. Sólo se puede usar lo que el proyecto tiene asignado
 * (comprado para él, tomado del stock o transferido). El costo sale del lote, no se tipea.
 */
export function registerUsage(
  project: Project,
  stock: StockState,
  input: MaterialUsageInput,
  settings: AlertSettings,
  ctx: Ctx,
): { project: Project; stock: StockState } {
  assertExecutable(project, "consumo de material");
  assertCanWork(project, ctx);
  if (input.itemId && !project.items.some((i) => i.id === input.itemId)) {
    throw new DomainError("El producto elegido no existe en este proyecto.");
  }
  const key = materialKey(input.materialId, input.materialName);
  const used = consumeMaterial(
    stock,
    { projectId: project.id, materialId: key, consumed: input.consumed, waste: input.waste, lotId: input.lotId, itemId: input.itemId, date: input.date, note: input.notes },
    ctx,
  );
  let next = applyChange(stock, used);

  const usages: MaterialUsageEntry[] = used.parts.map((part) => ({
    id: createId("use"),
    projectId: project.id,
    materialId: key,
    materialName: input.materialName,
    date: input.date,
    quantityConsumed: part.consumed,
    wasteQuantity: part.waste,
    reusableLeftoverQuantity: 0,
    unit: input.unit,
    unitCost: part.lot.unitCost,
    unitCostOrigin: usageOrigin(part.lot),
    source: usageSource(part.lot, project.id),
    reusableMaterialId: undefined,
    lotId: part.lot.id,
    itemId: input.itemId,
    notes: input.notes,
    createdBy: ctx.actor,
    createdAt: ctx.now,
  }));

  const events: ActivityEvent[] = usages.map((u) => activity("usage", ctx.actor, usageMessage(u), ctx.now));
  if (input.leftover && input.leftover.quantity > 0) {
    const change = markLeftover(
      next,
      {
        projectId: project.id,
        materialId: key,
        quantity: input.leftover.quantity,
        dims: input.leftover.dims,
        location: input.leftover.location,
        destination: input.leftover.destination,
        date: input.date,
      },
      ctx,
    );
    next = applyChange(next, change);
    events.push(
      activity("leftover", "Sistema", leftoverMessage(input.materialName, input.leftover.quantity, input.unit), ctx.now),
    );
  }

  const updated: Project = { ...project, materialUsages: [...project.materialUsages, ...usages] };
  return {
    project: touch(updated, ctx.now, [...deviationEvents(project, updated, settings, ctx), ...events]),
    stock: next,
  };
}

// ── Costos ────────────────────────────────────────────────────

export interface ActualInput {
  type: Exclude<ActualEntryType, "labor">;
  /** Solo para "other": Diseño, Administración o Gasto financiero. */
  category?: OtherCostCategory;
  description: string;
  date: string;
  supplier?: string;
  notes?: string;
  amount: number;
  itemId?: string;
}

/** Categoría de reporte de un costo real: la elegida en Diseño / Administración / Gasto financiero, o la del tipo. */
export function actualInputCategory(input: Pick<ActualInput, "type" | "category">): BudgetCategory {
  return input.type === "other" && input.category ? input.category : ACTUAL_TYPE_TO_CATEGORY[input.type];
}

/** Costos monetarios que no son materiales ni horas (trabajo comprado hecho, montaje, fletes, diseño, administración, gasto financiero…). Sólo Gestión. */
export function addActual(project: Project, input: ActualInput, settings: AlertSettings, ctx: Ctx): Project {
  assertManager(ctx, "Cargar costos extra");
  assertExecutable(project, "costos de ejecución");
  if (!(input.amount > 0)) throw new DomainError("Indicá un monto mayor a cero.");
  const entry: ActualEntry = {
    id: createId("act"),
    projectId: project.id,
    date: input.date,
    type: input.type,
    category: actualInputCategory(input),
    description: input.description || ACTUAL_TYPE_LABELS[input.type],
    amount: input.amount,
    supplier: input.supplier,
    itemId: input.itemId,
    notes: input.notes,
    createdBy: ctx.actor,
    createdAt: ctx.now,
  };
  const updated: Project = { ...project, actualEntries: [...project.actualEntries, entry] };
  return touch(updated, ctx.now, [...deviationEvents(project, updated, settings, ctx), activity("cost", ctx.actor, actualMessage(entry), ctx.now)]);
}

/**
 * Horas cargadas (Lote 6): SIEMPRE contra una asignación (producto + rubro + operario + día).
 * Proyecto, producto, rubro, operario y fecha salen de la asignación: no se tipean.
 */
export interface HoursInput {
  requestId?: string;
  assignmentId: string;
  hours: number;
  /** Tipo de trabajo (por defecto, el rubro). */
  workType?: string;
  comment?: string;
  /** Jornada de Configuración: por encima se pide confirmar (aviso, no bloqueo). */
  workdayHours?: number;
  /** Confirma una carga por encima de la jornada. */
  confirmHighHours?: boolean;
}

/**
 * Horas de un operario. El costo/hora sale de la tabla de operarios (no se tipea) y se congela
 * en el registro: cambiar la tarifa después no altera el historial.
 */
export function logHours(
  project: Project,
  operators: Operator[],
  assignments: WorkAssignment[],
  input: HoursInput,
  settings: AlertSettings,
  ctx: Ctx,
  /** Costo de una hora ese día (precios con vigencia, Lote 5A). Sin él, el costo por hora cargado del operario. */
  costAt: (op: Operator, date: string) => number = (op) => op.hourlyCost,
): Project {
  assertExecutable(project, "horas de trabajo");
  assertCanWork(project, ctx);
  const a = assignments.find((x) => x.id === input.assignmentId);
  if (!a || a.projectId !== project.id) throw new DomainError("Las horas se cargan contra una asignación (producto, rubro, operario y día).");
  const isOperator = roleOf(ctx) === "operator";
  if (isOperator && a.operatorId !== ctx.operatorId) throw new RuleError("Esa asignación no es tuya.");
  const op = operators.find((o) => o.id === a.operatorId);
  if (!op) throw new DomainError("Operario no encontrado.");
  if (!op.active) throw new DomainError(`${op.name} está dado de baja: reactivalo en Operarios para cargarle horas.`);
  const check = checkHours(project.actualEntries, op.id, a.date, input.hours, todayISO(), input.workdayHours);
  if (check.level === "block") throw new RuleError(check.message ?? "Horas inválidas.");
  if (check.level === "warn" && !input.confirmHighHours) throw new RuleError(`${check.message} Confirmá para guardarlas.`);

  const workType = input.workType?.trim() || rubroDef(a.rubro).label;
  const hourlyCost = costAt(op, a.date);
  const entry: ActualEntry = {
    id: input.requestId ?? createId("act"),
    projectId: project.id,
    date: a.date,
    type: "labor",
    category: a.hourKind ?? "labor",
    description: `${workType} — ${op.name}`,
    amount: Math.round(input.hours * hourlyCost * 100) / 100,
    labor: { role: workType, workerName: op.name, hours: input.hours, hourlyCost },
    operatorId: op.id,
    stage: project.status === "approved" ? "production" : project.status as StageKey,
    itemId: a.itemId,
    rubro: a.rubro,
    assignmentId: a.id,
    notes: input.comment,
    createdBy: ctx.actor,
    createdAt: ctx.now,
  };
  const updated: Project = { ...project, actualEntries: [...project.actualEntries, entry] };
  return touch(updated, ctx.now, [...deviationEvents(project, updated, settings, ctx), activity("cost", ctx.actor, actualMessage(entry), ctx.now)]);
}

// ── Cierre ────────────────────────────────────────────────────

/** Material asignado y sin consumir que impide cerrar. */
export function closeBlockers(stock: StockState, projectId: string) {
  return unresolvedMaterial(stock, projectId);
}

export function closeProject(project: Project, stock: StockState, ctx: Ctx): Project {
  if (project.isClosed) return project;
  assertManager(ctx, "Cerrar el proyecto");
  const open = unresolvedMaterial(stock, project.id);
  if (open.length > 0) {
    throw new RuleError(
      `No se puede cerrar: hay material sin destino (${open
        .map((h) => `${formatQty(h.quantity, h.lot.unit)} de ${h.lot.materialName}`)
        .join(", ")}). Devolvelo al stock, transferilo, marcalo como sobrante, desperdicio o devolvelo al proveedor.`,
    );
  }
  return touch({ ...project, status: "completed", isClosed: true, closedAt: ctx.now }, ctx.now, [
    activity("closed", ctx.actor, "Proyecto cerrado. Rentabilidad real calculada.", ctx.now),
  ]);
}

// ── Operarios asignados ───────────────────────────────────────

export function assignOperators(project: Project, operatorIds: string[], operators: Operator[], ctx: Ctx): Project {
  assertManager(ctx, "Asignar operarios");
  assertOpen(project);
  // Solo operarios activos: al guardar el equipo, los dados de baja dejan de estar asignados.
  const valid = operatorIds.filter((id) => operators.some((o) => o.id === id && o.active));
  const names = valid.map((id) => operators.find((o) => o.id === id)?.name).filter(Boolean);
  return touch({ ...project, assignedOperatorIds: valid }, ctx.now, [
    activity("stage", ctx.actor, names.length ? `Operarios asignados: ${names.join(", ")}.` : "Se quitaron los operarios asignados.", ctx.now),
  ]);
}

/**
 * Baja de un operario en un proyecto abierto: lo saca del equipo y, si hay destino, suma a ese operario.
 * Deja registro en la Actividad. No toca horas ni costos.
 */
export function reassignForDeactivation(
  project: Project,
  operatorId: string,
  target: string | null,
  operators: Operator[],
  ctx: Ctx,
): Project {
  assertManager(ctx, "Reasignar operarios");
  if (!project.assignedOperatorIds.includes(operatorId)) return project;
  const rest = project.assignedOperatorIds.filter((x) => x !== operatorId);
  const next = { ...project, assignedOperatorIds: target && !rest.includes(target) ? [...rest, target] : rest };
  const leaving = operators.find((o) => o.id === operatorId)?.name ?? "El operario";
  const incoming = target ? operators.find((o) => o.id === target)?.name : null;
  return touch(next, ctx.now, [
    activity(
      "stage",
      ctx.actor,
      incoming
        ? `${leaving} fue dado de baja. Su lugar en el equipo lo toma ${incoming}.`
        : `${leaving} fue dado de baja. El proyecto quedó sin ese operario asignado.`,
      ctx.now,
    ),
  ]);
}

// ── Productos del proyecto (antes "muebles") ─────────────────

/** Alta de un producto con sus rubros (horas estimadas y operarios pedidos). Lo hace el Administrativo. */
export function addItem(project: Project, input: ProductInput, ctx: Ctx): Project {
  assertManager(ctx, "Editar los productos");
  assertOpen(project);
  const error = productInputError(input);
  if (error) throw new DomainError(error);
  const item: ProjectItem = {
    id: createId("itm"),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    quantity: input.quantity,
    rubros: input.rubros,
    completedUnits: 0,
  };
  return touch({ ...project, items: [...project.items, item] }, ctx.now, [
    activity("stage", ctx.actor, `Se agregó el producto “${item.name}” × ${item.quantity}.`, ctx.now),
  ]);
}

/** Cambia nombre, cantidad o rubros de un producto. La cantidad no puede quedar por debajo de lo ya terminado. */
export function updateItem(project: Project, itemId: string, input: ProductInput, ctx: Ctx): Project {
  assertManager(ctx, "Editar los productos");
  assertOpen(project);
  const current = project.items.find((i) => i.id === itemId);
  if (!current) throw new DomainError("Producto no encontrado.");
  const error = productInputError(input, current.completedUnits);
  if (error) throw new DomainError(error);
  const next: ProjectItem = { ...current, name: input.name.trim(), description: input.description?.trim() || undefined, quantity: input.quantity, rubros: input.rubros };
  return touch({ ...project, items: project.items.map((i) => (i.id === itemId ? next : i)) }, ctx.now, [
    activity("stage", ctx.actor, `Se actualizó el producto “${next.name}”.`, ctx.now),
  ]);
}

export function removeItem(project: Project, itemId: string, ctx: Ctx): Project {
  assertManager(ctx, "Editar los productos");
  assertOpen(project);
  const used =
    project.materialUsages.some((u) => u.itemId === itemId) ||
    project.actualEntries.some((a) => a.itemId === itemId) ||
    project.attachments.some((a) => a.itemId === itemId) ||
    project.stageLogs.some((l) => l.itemId === itemId);
  if (used) throw new DomainError("Ese producto ya tiene materiales, horas, archivos o notas asociadas: no se puede quitar.");
  return touch({ ...project, items: project.items.filter((i) => i.id !== itemId) }, ctx.now, []);
}

// ── Bitácora por etapa ────────────────────────────────────────

export interface StageLogInput {
  stage: StageKey;
  date: string;
  kind: "note" | "incident";
  text: string;
  responsible?: string;
  itemId?: string;
}

export function addStageLog(project: Project, input: StageLogInput, ctx: Ctx): { project: Project; log: StageLog } {
  assertOpen(project);
  assertCanWork(project, ctx);
  const text = input.text.trim();
  if (text.length < 3) throw new DomainError("Contá brevemente qué pasó.");
  if (project.status === "quotation") {
    throw new RuleError(`El proyecto todavía no llegó a ${STATUS_LABELS[input.stage]}.`);
  }
  const log: StageLog = {
    id: createId("log"),
    projectId: project.id,
    stage: input.stage,
    date: input.date,
    kind: input.kind,
    text,
    responsible: input.responsible?.trim() || undefined,
    itemId: input.itemId,
    createdBy: ctx.actor,
    createdAt: ctx.now,
  };
  const label = input.kind === "incident" ? "incidente" : "nota";
  return {
    project: touch({ ...project, stageLogs: [...project.stageLogs, log] }, ctx.now, [
      activity("stage", ctx.actor, `Se registró un ${label} en ${STATUS_LABELS[input.stage]}.`, ctx.now),
    ]),
    log,
  };
}

// ── Adjuntos ──────────────────────────────────────────────────

export function addAttachment(project: Project, attachment: Attachment, ctx: Ctx): Project {
  assertOpen(project);
  assertCanWork(project, ctx);
  return touch({ ...project, attachments: [...project.attachments, attachment] }, ctx.now, [
    activity("stage", ctx.actor, `Se adjuntó “${attachment.name}”.`, ctx.now),
  ]);
}

export function removeAttachment(project: Project, attachmentId: string, ctx: Ctx): Project {
  assertManager(ctx, "Quitar archivos");
  assertOpen(project);
  return touch({ ...project, attachments: project.attachments.filter((a) => a.id !== attachmentId) }, ctx.now, []);
}

// ── Movimientos de stock entre proyectos (Gestión) ────────────

export interface StockMoveBase {
  materialId: string;
  quantity: number;
  lotId?: string;
  date?: string;
  note?: string;
}

type ProjectsAndStock = { projects: Project[]; stock: StockState };

function withProject(projects: Project[], id: string): Project {
  const p = projects.find((x) => x.id === id);
  if (!p) throw new DomainError("Proyecto no encontrado.");
  return p;
}

function replaceProjects(projects: Project[], ...changed: Project[]): Project[] {
  return projects.map((p) => changed.find((c) => c.id === p.id) ?? p);
}

function assertReceivesMaterial(p: Project) {
  assertOpen(p);
  if (p.status === "quotation") throw new RuleError(`${p.code} está en Cotización: aprobalo antes de asignarle material.`);
}

function stockEvent(project: Project, ctx: Ctx, message: string): Project {
  return touch(project, ctx.now, [activity("stock", ctx.actor, message, ctx.now)]);
}

export function assignStockToProject(
  projects: Project[],
  stock: StockState,
  input: StockMoveBase & { projectId: string; materialName: string; unit: string },
  ctx: Ctx,
): ProjectsAndStock {
  assertManager(ctx, "Asignar material");
  const p = withProject(projects, input.projectId);
  assertReceivesMaterial(p);
  const next = applyChange(stock, assignToProject(stock, { ...input }, ctx));
  const q = formatQty(input.quantity, input.unit);
  return { projects: replaceProjects(projects, stockEvent(p, ctx, `Se asignaron ${q} de ${input.materialName} desde el stock.`)), stock: next };
}

export function releaseProjectStock(
  projects: Project[],
  stock: StockState,
  input: StockMoveBase & { projectId: string; materialName: string; unit: string },
  ctx: Ctx,
): ProjectsAndStock {
  assertManager(ctx, "Liberar material");
  const p = withProject(projects, input.projectId);
  assertOpen(p);
  const next = applyChange(stock, releaseToWarehouse(stock, { ...input }, ctx));
  const q = formatQty(input.quantity, input.unit);
  return { projects: replaceProjects(projects, stockEvent(p, ctx, `Se devolvieron ${q} de ${input.materialName} al stock.`)), stock: next };
}

export function transferProjectStock(
  projects: Project[],
  stock: StockState,
  input: StockMoveBase & { fromProjectId: string; toProjectId: string; materialName: string; unit: string },
  ctx: Ctx,
): ProjectsAndStock {
  assertManager(ctx, "Transferir material");
  const from = withProject(projects, input.fromProjectId);
  const to = withProject(projects, input.toProjectId);
  assertOpen(from);
  assertReceivesMaterial(to);
  const next = applyChange(stock, transferBetweenProjects(stock, { ...input }, ctx));
  const q = formatQty(input.quantity, input.unit);
  return {
    projects: replaceProjects(
      projects,
      stockEvent(from, ctx, `Se transfirieron ${q} de ${input.materialName} a ${to.code}.`),
      stockEvent(to, ctx, `Se recibieron ${q} de ${input.materialName} de ${from.code}.`),
    ),
    stock: next,
  };
}

export function returnProjectStockToSupplier(
  projects: Project[],
  stock: StockState,
  input: StockMoveBase & { projectId: string; materialName: string; unit: string },
  ctx: Ctx,
): ProjectsAndStock {
  assertManager(ctx, "Devolver material al proveedor");
  const p = withProject(projects, input.projectId);
  assertOpen(p);
  const next = applyChange(stock, returnToSupplier(stock, { ...input, from: { projectId: p.id } }, ctx));
  const q = formatQty(input.quantity, input.unit);
  return { projects: replaceProjects(projects, stockEvent(p, ctx, `Se devolvieron ${q} de ${input.materialName} al proveedor.`)), stock: next };
}

export function leftoverFromProject(
  projects: Project[],
  stock: StockState,
  input: StockMoveBase & {
    projectId: string;
    materialName: string;
    unit: string;
    dims?: LeftoverDims;
    location?: string;
    destination?: "warehouse" | { projectId: string };
  },
  ctx: Ctx,
): ProjectsAndStock {
  assertManager(ctx, "Marcar sobrantes");
  const p = withProject(projects, input.projectId);
  assertOpen(p);
  const dest = input.destination && input.destination !== "warehouse" ? withProject(projects, input.destination.projectId) : null;
  if (dest) assertReceivesMaterial(dest);
  const next = applyChange(stock, markLeftover(stock, { ...input }, ctx));
  const updated = [stockEvent(p, ctx, leftoverMessage(input.materialName, input.quantity, input.unit))];
  if (dest) updated.push(stockEvent(dest, ctx, `Recibió ${formatQty(input.quantity, input.unit)} de sobrante de ${input.materialName} de ${p.code}.`));
  return { projects: replaceProjects(projects, ...updated), stock: next };
}
