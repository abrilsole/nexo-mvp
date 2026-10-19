// ─────────────────────────────────────────────────────────────
// Traducción entre el modelo de dominio (types/) y las filas de Supabase.
// El dominio no conoce la base: todo el snake_case vive acá.
// ─────────────────────────────────────────────────────────────
import { DEFAULT_FINANCIAL_PCT, DEFAULT_HOURS_PER_DAY, DEFAULT_OVERTIME_MULTIPLIER, HOUR_CATEGORIES, normalizeCategory } from "@/lib/constants";
import { isRubroId } from "@/lib/rubros";
import type {
  ActivityEvent,
  ProductRubro,
  PurchaseOrder,
  PurchaseOrderLine,
  ActualEntry,
  Attachment,
  BudgetLine,
  CostSettings,
  HourRate,
  LaborValuation,
  MaterialRequest,
  MaterialUsageEntry,
  DayException,
  Operator,
  Place,
  Project,
  ProjectItem,
  PriceRecord,
  PurchaseEntry,
  ReusableMaterial,
  StageLog,
  StockLot,
  StockMovement,
  ValueCorrection,
  WorkAssignment,
} from "@/types";

type Row = Record<string, unknown>;

const isHourCategory = (v: unknown): v is HourRate["category"] => typeof v === "string" && (HOUR_CATEGORIES as string[]).includes(v);

/** La línea base se guarda como JSON: sus líneas también pasan por la normalización de categorías. */
function baselineFromJson(b: Project["baseline"] | null): Project["baseline"] {
  if (!b) return undefined;
  return { ...b, lines: b.lines.map((l) => ({ ...l, category: normalizeCategory(String(l.category), l.description) })) };
}

/** Postgres devuelve timestamptz como "…+00:00"; el dominio usa ISO con "Z". */
function iso(v: unknown): string {
  return new Date(String(v)).toISOString();
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}
function opt<T>(v: T | null | undefined): T | undefined {
  return v ?? undefined;
}

export const CHILD_TABLES = {
  budgetLines: "budget_lines",
  purchaseEntries: "purchase_entries",
  materialUsages: "material_usages",
  actualEntries: "actual_entries",
  activity: "activity_events",
  items: "project_items",
  stageLogs: "stage_logs",
  attachments: "attachments",
} as const;

export type ChildKey = keyof typeof CHILD_TABLES;

// ── Proyecto ──────────────────────────────────────────────

export function projectToRow(org: string, p: Project): Row {
  return {
    organization_id: org,
    id: p.id,
    code: p.code,
    name: p.name,
    client: p.client,
    project_type: p.projectType,
    description: p.description,
    status: p.status,
    start_date: p.startDate,
    due_date: p.dueDate,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    sales_price: p.salesPrice,
    owner: p.owner,
    assigned_operator_ids: p.assignedOperatorIds,
    baseline: p.baseline ?? null,
    is_closed: p.isClosed,
    closed_at: p.closedAt ?? null,
  };
}

// ── Hijos ─────────────────────────────────────────────────

const childToRow: { [K in ChildKey]: (org: string, projectId: string, item: Project[K][number], position: number) => Row } = {
  budgetLines: (org, projectId, l: BudgetLine, position) => ({
    organization_id: org,
    id: l.id,
    project_id: projectId,
    position,
    category: l.category,
    description: l.description,
    material_id: l.materialId ?? null,
    quantity: l.quantity,
    unit: l.unit,
    unit_cost: l.unitCost,
    total: l.total,
    notes: l.notes ?? null,
    rubro: l.rubro ?? null,
    hour_rate_id: l.hourRateId ?? null,
    operator_id: l.operatorId ?? null,
    hour_type: l.hourType ?? null,
    overtime_multiplier: l.overtimeMultiplier ?? null,
    hours_per_day: l.hoursPerDay ?? null,
    workers: l.workers ?? null,
  }),
  purchaseEntries: (org, projectId, e: PurchaseEntry, position) => ({
    organization_id: org,
    id: e.id,
    project_id: projectId,
    position,
    material_id: e.materialId ?? null,
    material_name: e.materialName,
    quantity: e.quantity,
    unit: e.unit,
    unit_cost: e.unitCost,
    total: e.total,
    supplier: e.supplier ?? null,
    date: e.date,
    notes: e.notes ?? null,
    created_by: e.createdBy,
    created_at: e.createdAt,
  }),
  materialUsages: (org, projectId, u: MaterialUsageEntry, position) => ({
    organization_id: org,
    id: u.id,
    project_id: projectId,
    position,
    material_id: u.materialId,
    material_name: u.materialName,
    date: u.date,
    quantity_consumed: u.quantityConsumed,
    waste_quantity: u.wasteQuantity,
    reusable_leftover_quantity: u.reusableLeftoverQuantity,
    unit: u.unit,
    unit_cost: u.unitCost,
    unit_cost_origin: u.unitCostOrigin,
    source: u.source,
    reusable_material_id: u.reusableMaterialId ?? null,
    lot_id: u.lotId ?? null,
    item_id: u.itemId ?? null,
    notes: u.notes ?? null,
    created_by: u.createdBy,
    created_at: u.createdAt,
  }),
  actualEntries: (org, projectId, a: ActualEntry, position) => ({
    organization_id: org,
    id: a.id,
    project_id: projectId,
    position,
    date: a.date,
    type: a.type,
    category: a.category,
    description: a.description,
    amount: a.amount,
    supplier: a.supplier ?? null,
    labor: a.labor ?? null,
    operator_id: a.operatorId ?? null,
    stage: a.stage ?? null,
    item_id: a.itemId ?? null,
    rubro: a.rubro ?? null,
    assignment_id: a.assignmentId ?? null,
    notes: a.notes ?? null,
    created_by: a.createdBy,
    created_at: a.createdAt,
  }),
  activity: (org, projectId, e: ActivityEvent, position) => ({
    organization_id: org,
    id: e.id,
    project_id: projectId,
    position,
    at: e.at,
    actor: e.actor,
    kind: e.kind,
    message: e.message,
  }),
  items: (org, projectId, i: ProjectItem, position) => ({
    organization_id: org,
    id: i.id,
    project_id: projectId,
    position,
    name: i.name,
    description: i.description ?? null,
    quantity: i.quantity,
    rubros: i.rubros,
    completed_units: i.completedUnits,
  }),
  stageLogs: (org, projectId, l: StageLog, position) => ({
    organization_id: org,
    id: l.id,
    project_id: projectId,
    position,
    stage: l.stage,
    date: l.date,
    kind: l.kind,
    text: l.text,
    responsible: l.responsible ?? null,
    item_id: l.itemId ?? null,
    created_by: l.createdBy,
    created_at: l.createdAt,
  }),
  attachments: (org, projectId, a: Attachment, position) => ({
    organization_id: org,
    id: a.id,
    project_id: projectId,
    position,
    item_id: a.itemId ?? null,
    stage: a.stage ?? null,
    stage_log_id: a.stageLogId ?? null,
    name: a.name,
    mime_type: a.mimeType,
    size: a.size,
    storage_path: a.storagePath,
    uploaded_by: a.uploadedBy,
    uploaded_at: a.uploadedAt,
  }),
};

export function childrenToRows<K extends ChildKey>(key: K, org: string, projectId: string, items: Project[K]): Row[] {
  const toRow = childToRow[key] as (org: string, projectId: string, item: unknown, position: number) => Row;
  return items.map((item, i) => toRow(org, projectId, item, i));
}

function budgetLineFromRow(r: Row): BudgetLine {
  return {
    id: String(r.id),
    category: normalizeCategory(String(r.category), String(r.description)),
    description: String(r.description),
    materialId: opt(r.material_id as string | null),
    quantity: r.quantity === null ? null : num(r.quantity),
    unit: String(r.unit),
    unitCost: num(r.unit_cost),
    total: num(r.total),
    notes: opt(r.notes as string | null),
    rubro: isRubroId(r.rubro) ? r.rubro : undefined,
    hourRateId: opt(r.hour_rate_id as string | null | undefined),
    operatorId: opt(r.operator_id as string | null | undefined),
    hourType: r.hour_type === "normal" || r.hour_type === "overtime" ? r.hour_type : undefined,
    overtimeMultiplier: r.overtime_multiplier === null || r.overtime_multiplier === undefined ? undefined : num(r.overtime_multiplier),
    hoursPerDay: r.hours_per_day === null || r.hours_per_day === undefined ? undefined : num(r.hours_per_day),
    workers: r.workers === null || r.workers === undefined ? undefined : num(r.workers),
  };
}

function purchaseFromRow(r: Row): PurchaseEntry {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    materialId: opt(r.material_id as string | null),
    materialName: String(r.material_name),
    quantity: num(r.quantity),
    unit: String(r.unit),
    unitCost: num(r.unit_cost),
    total: num(r.total),
    supplier: opt(r.supplier as string | null),
    date: String(r.date),
    notes: opt(r.notes as string | null),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}

function usageFromRow(r: Row): MaterialUsageEntry {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    materialId: String(r.material_id),
    materialName: String(r.material_name),
    date: String(r.date),
    quantityConsumed: num(r.quantity_consumed),
    wasteQuantity: num(r.waste_quantity),
    reusableLeftoverQuantity: num(r.reusable_leftover_quantity),
    unit: String(r.unit),
    unitCost: num(r.unit_cost),
    unitCostOrigin: r.unit_cost_origin as MaterialUsageEntry["unitCostOrigin"],
    source: r.source as MaterialUsageEntry["source"],
    reusableMaterialId: opt(r.reusable_material_id as string | null),
    lotId: opt(r.lot_id as string | null),
    itemId: opt(r.item_id as string | null),
    notes: opt(r.notes as string | null),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}

function actualFromRow(r: Row): ActualEntry {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    date: String(r.date),
    type: r.type as ActualEntry["type"],
    category: normalizeCategory(String(r.category), String(r.description)),
    description: String(r.description),
    amount: num(r.amount),
    supplier: opt(r.supplier as string | null),
    labor: opt(r.labor as ActualEntry["labor"] | null),
    operatorId: opt(r.operator_id as string | null),
    stage: opt(r.stage as ActualEntry["stage"] | null),
    itemId: opt(r.item_id as string | null),
    rubro: isRubroId(r.rubro) ? r.rubro : undefined,
    assignmentId: opt(r.assignment_id as string | null | undefined),
    notes: opt(r.notes as string | null),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}

function activityFromRow(r: Row): ActivityEvent {
  return {
    id: String(r.id),
    at: iso(r.at),
    actor: String(r.actor),
    kind: r.kind as ActivityEvent["kind"],
    message: String(r.message),
  };
}

function itemFromRow(r: Row): ProjectItem {
  return {
    id: String(r.id),
    name: String(r.name),
    description: opt(r.description as string | null),
    quantity: num(r.quantity),
    rubros: productRubrosOf(r.rubros),
    completedUnits: num(r.completed_units ?? 0),
  };
}

/** Rubros de un producto guardados como jsonb: se descartan los que no son del catálogo. */
function productRubrosOf(v: unknown): ProductRubro[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x: Record<string, unknown>) =>
    isRubroId(x?.rubro) ? [{ rubro: x.rubro, hours: num(x.hours), workers: Math.max(1, Math.round(num(x.workers ?? 1))) }] : [],
  );
}

function stageLogFromRow(r: Row): StageLog {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    stage: r.stage as StageLog["stage"],
    date: String(r.date),
    kind: r.kind as StageLog["kind"],
    text: String(r.text),
    responsible: opt(r.responsible as string | null),
    itemId: opt(r.item_id as string | null),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}

function attachmentFromRow(r: Row): Attachment {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    itemId: opt(r.item_id as string | null),
    stage: opt(r.stage as Attachment["stage"] | null),
    stageLogId: opt(r.stage_log_id as string | null),
    name: String(r.name),
    mimeType: String(r.mime_type),
    size: num(r.size),
    storagePath: String(r.storage_path),
    uploadedBy: String(r.uploaded_by),
    uploadedAt: iso(r.uploaded_at),
  };
}

export interface ProjectRows {
  projects: Row[];
  budgetLines: Row[];
  purchaseEntries: Row[];
  materialUsages: Row[];
  actualEntries: Row[];
  activity: Row[];
  items: Row[];
  stageLogs: Row[];
  attachments: Row[];
}

/** Arma los proyectos completos a partir de las filas (ya ordenadas por position). */
export function projectsFromRows(rows: ProjectRows): Project[] {
  const byProject = <T>(list: Row[], map: (r: Row) => T) => {
    const out = new Map<string, T[]>();
    for (const r of list) {
      const key = String(r.project_id);
      const arr = out.get(key) ?? [];
      arr.push(map(r));
      out.set(key, arr);
    }
    return out;
  };
  const lines = byProject(rows.budgetLines, budgetLineFromRow);
  const purchases = byProject(rows.purchaseEntries, purchaseFromRow);
  const usages = byProject(rows.materialUsages, usageFromRow);
  const actuals = byProject(rows.actualEntries, actualFromRow);
  const activity = byProject(rows.activity, activityFromRow);
  const items = byProject(rows.items, itemFromRow);
  const stageLogs = byProject(rows.stageLogs, stageLogFromRow);
  const attachments = byProject(rows.attachments, attachmentFromRow);

  return rows.projects.map((r) => {
    const id = String(r.id);
    return {
      id,
      code: String(r.code),
      name: String(r.name),
      client: String(r.client),
      projectType: String(r.project_type),
      description: String(r.description),
      status: r.status as Project["status"],
      startDate: String(r.start_date),
      dueDate: String(r.due_date),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      salesPrice: num(r.sales_price),
      owner: String(r.owner),
      budgetLines: lines.get(id) ?? [],
      purchaseEntries: purchases.get(id) ?? [],
      materialUsages: usages.get(id) ?? [],
      actualEntries: actuals.get(id) ?? [],
      activity: activity.get(id) ?? [],
      isClosed: Boolean(r.is_closed),
      closedAt: r.closed_at ? iso(r.closed_at) : undefined,
      assignedOperatorIds: (r.assigned_operator_ids as string[] | null) ?? [],
      items: items.get(id) ?? [],
      stageLogs: stageLogs.get(id) ?? [],
      attachments: attachments.get(id) ?? [],
      baseline: baselineFromJson(r.baseline as Project["baseline"] | null),
      ...("materials_state" in r ? { materialsState: materialsStateOf(r.materials_state) } : {}),
    };
  });
}

/** Estado de materiales que manda planta_workspace (el Jefe de planta no recibe costos ni órdenes). */
function materialsStateOf(v: unknown): Project["materialsState"] {
  return v === "none" || v === "on_the_way" || v === "complete" ? v : null;
}

// ── Pool de sobrantes ─────────────────────────────────────

export function reusableToRow(org: string, m: ReusableMaterial, position: number): Row {
  return {
    organization_id: org,
    id: m.id,
    position,
    material_id: m.materialId,
    material_name: m.materialName,
    quantity: m.quantity,
    unit: m.unit,
    unit_cost: m.unitCost,
    origin_project_id: m.originProjectId,
    origin_project_name: m.originProjectName,
    created_at: m.createdAt,
  };
}

export function reusableFromRow(r: Row): ReusableMaterial {
  return {
    id: String(r.id),
    materialId: String(r.material_id),
    materialName: String(r.material_name),
    quantity: num(r.quantity),
    unit: String(r.unit),
    unitCost: num(r.unit_cost),
    originProjectId: String(r.origin_project_id),
    originProjectName: String(r.origin_project_name),
    createdAt: iso(r.created_at),
  };
}

// ── Operarios ─────────────────────────────────────────────

export function operatorToRow(org: string, o: Operator, position: number): Row {
  return {
    organization_id: org,
    id: o.id,
    position,
    name: o.name,
    role: o.role,
    hourly_cost: o.hourlyCost,
    active: o.active,
    deactivated_at: o.deactivatedAt ?? null,
    user_id: o.userId ?? null,
    email: o.email ?? null,
    created_at: o.createdAt,
    work_days: o.workDays ?? null,
  };
}

export function operatorFromRow(r: Row): Operator {
  return {
    id: String(r.id),
    name: String(r.name),
    role: String(r.role),
    hourlyCost: num(r.hourly_cost),
    active: Boolean(r.active),
    deactivatedAt: r.deactivated_at ? iso(r.deactivated_at) : undefined,
    userId: opt(r.user_id as string | null),
    email: opt(r.email as string | null),
    createdAt: iso(r.created_at),
    workDays: Array.isArray(r.work_days) ? (r.work_days as unknown[]).map(Number) : undefined,
  };
}

/** Excepción de día laboral (Lote 6 · Fase 3). */
export function dayExceptionFromRow(r: Row): DayException {
  return {
    operatorId: String(r.operator_id),
    date: String(r.date),
    works: r.works === true,
    hours: r.hours === null || r.hours === undefined ? undefined : num(r.hours),
    note: opt(r.note as string | null),
    createdBy: String(r.created_by ?? ""),
    createdAt: iso(r.created_at),
  };
}

// ── Stock ─────────────────────────────────────────────────

export function lotToRow(org: string, l: StockLot): Row {
  return {
    organization_id: org,
    id: l.id,
    material_id: l.materialId,
    material_name: l.materialName,
    unit: l.unit,
    unit_cost: l.unitCost,
    kind: l.kind,
    supplier: l.supplier ?? null,
    purchase_entry_id: l.purchaseEntryId ?? null,
    origin_project_id: l.originProjectId ?? null,
    origin_project_name: l.originProjectName ?? null,
    parent_lot_id: l.parentLotId ?? null,
    location: l.location ?? null,
    dims: l.dims ?? null,
    notes: l.notes ?? null,
    created_by: l.createdBy,
    created_at: l.createdAt,
  };
}

export function lotFromRow(r: Row): StockLot {
  return {
    id: String(r.id),
    materialId: String(r.material_id),
    materialName: String(r.material_name),
    unit: String(r.unit),
    unitCost: num(r.unit_cost),
    kind: r.kind as StockLot["kind"],
    supplier: opt(r.supplier as string | null),
    purchaseEntryId: opt(r.purchase_entry_id as string | null),
    originProjectId: opt(r.origin_project_id as string | null),
    originProjectName: opt(r.origin_project_name as string | null),
    parentLotId: opt(r.parent_lot_id as string | null),
    location: opt(r.location as string | null),
    dims: opt(r.dims as StockLot["dims"] | null),
    notes: opt(r.notes as string | null),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}

export function movementToRow(org: string, m: StockMovement, position: number): Row {
  return {
    organization_id: org,
    id: m.id,
    lot_id: m.lotId,
    position,
    kind: m.kind,
    quantity: m.quantity,
    from_place: m.from,
    to_place: m.to,
    date: m.date,
    project_id: m.projectId ?? null,
    item_id: m.itemId ?? null,
    into_lot_id: m.intoLotId ?? null,
    group_id: m.groupId ?? null,
    note: m.note ?? null,
    created_by: m.createdBy,
    created_at: m.createdAt,
  };
}

export function movementFromRow(r: Row): StockMovement {
  return {
    id: String(r.id),
    lotId: String(r.lot_id),
    kind: r.kind as StockMovement["kind"],
    quantity: num(r.quantity),
    from: r.from_place as Place,
    to: r.to_place as Place,
    date: String(r.date),
    projectId: opt(r.project_id as string | null),
    itemId: opt(r.item_id as string | null),
    intoLotId: opt(r.into_lot_id as string | null),
    groupId: opt(r.group_id as string | null),
    note: opt(r.note as string | null),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
  };
}

// ── Pedidos de material ───────────────────────────────────

export function requestToRow(org: string, q: MaterialRequest, position: number): Row {
  return {
    organization_id: org,
    id: q.id,
    position,
    project_id: q.projectId,
    material_id: q.materialId,
    material_name: q.materialName,
    quantity: q.quantity,
    unit: q.unit,
    note: q.note ?? null,
    requested_by: q.requestedBy,
    status: q.status,
    created_at: q.createdAt,
    resolved_at: q.resolvedAt ?? null,
    resolved_by: q.resolvedBy ?? null,
  };
}

export function requestFromRow(r: Row): MaterialRequest {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    materialId: String(r.material_id),
    materialName: String(r.material_name),
    quantity: num(r.quantity),
    unit: String(r.unit),
    note: opt(r.note as string | null),
    requestedBy: String(r.requested_by),
    status: r.status as MaterialRequest["status"],
    createdAt: iso(r.created_at),
    resolvedAt: r.resolved_at ? iso(r.resolved_at) : undefined,
    resolvedBy: opt(r.resolved_by as string | null),
  };
}

// ── Costos de Gestión (Taller nunca los lee) ──────────────────

export function costSettingsFromRow(r: Row): CostSettings {
  const m = r.overtime_multiplier === null || r.overtime_multiplier === undefined ? NaN : Number(r.overtime_multiplier);
  const f = r.financial_pct === null || r.financial_pct === undefined ? NaN : Number(r.financial_pct);
  const h = r.hours_per_day === null || r.hours_per_day === undefined ? NaN : Number(r.hours_per_day);
  return {
    overtimeMultiplier: Number.isFinite(m) && m >= 1 ? m : DEFAULT_OVERTIME_MULTIPLIER,
    financialPct: Number.isFinite(f) && f >= 0 ? f : DEFAULT_FINANCIAL_PCT,
    hoursPerDay: Number.isFinite(h) && h >= 1 && h <= 24 ? h : DEFAULT_HOURS_PER_DAY,
    laborValuation: (r.labor_valuation === "general" ? "general" : "operator") satisfies LaborValuation,
  };
}

// ── Precios con vigencia y correcciones (Lote 5A) ─────────

export function priceRecordToRow(org: string, r: PriceRecord): Row {
  return {
    organization_id: org,
    id: r.id,
    kind: r.kind,
    subject_id: r.subjectId,
    value: r.value,
    valid_from: r.validFrom,
    created_at: r.createdAt,
    created_by: r.createdBy,
  };
}

export function priceRecordFromRow(r: Row): PriceRecord {
  return {
    id: String(r.id),
    kind: r.kind as PriceRecord["kind"],
    subjectId: String(r.subject_id),
    value: num(r.value),
    validFrom: String(r.valid_from),
    createdAt: iso(r.created_at),
    createdBy: String(r.created_by ?? ""),
  };
}

export function correctionFromRow(r: Row): ValueCorrection {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    target: r.target as ValueCorrection["target"],
    lineId: opt(r.line_id as string | null),
    field: r.field as ValueCorrection["field"],
    description: String(r.description ?? ""),
    oldValue: r.old_value === null || r.old_value === undefined ? null : num(r.old_value),
    newValue: num(r.new_value),
    reason: String(r.reason),
    correctedBy: String(r.corrected_by),
    correctedAt: iso(r.corrected_at),
  };
}

export function hourRateFromRow(r: Row): HourRate {
  return {
    id: String(r.id),
    name: String(r.name),
    hourlyRate: num(r.hourly_rate),
    category: isHourCategory(r.kind) ? r.kind : "labor",
  };
}

/** La categoría va en `kind` (Lote 4b). La columna vieja `category` quedó en desuso: no se escribe. */
export function hourRateToRow(org: string, h: HourRate, position: number): Row {
  return { organization_id: org, id: h.id, name: h.name, hourly_rate: h.hourlyRate, kind: h.category, position, updated_at: new Date().toISOString() };
}

// ── Asignaciones (Lote 5B) ────────────────────────────────

export function assignmentFromRow(r: Row): WorkAssignment {
  return {
    hourKind: (r.hour_kind === "design" || r.hour_kind === "admin") ? r.hour_kind : "labor",
    id: String(r.id),
    projectId: String(r.project_id),
    itemId: opt(r.item_id as string | null),
    rubro: (isRubroId(r.rubro) ? r.rubro : "carpinteria_madera"),
    operatorId: String(r.operator_id),
    date: String(r.date),
    plannedHours: num(r.planned_hours),
    notes: opt(r.notes as string | null),
    createdBy: String(r.created_by ?? ""),
    createdAt: iso(r.created_at),
  };
}

/** Argumento de planta_save_assignment (la base valida y completa quién la cargó). */
export function assignmentToParams(a: Pick<WorkAssignment, "id" | "projectId" | "itemId" | "rubro" | "operatorId" | "date" | "plannedHours" | "notes" | "hourKind">): Row {
  return {
    id: a.id,
    hour_kind: a.hourKind ?? "labor",
    project_id: a.projectId,
    item_id: a.itemId ?? null,
    rubro: a.rubro,
    operator_id: a.operatorId,
    date: a.date,
    planned_hours: a.plannedHours,
    notes: a.notes ?? null,
  };
}

export function orderLineFromRow(r: Row): PurchaseOrderLine {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    budgetLineId: String(r.budget_line_id),
    materialId: opt(r.material_id as string | null),
    materialName: String(r.material_name),
    unit: String(r.unit ?? ""),
    quantity: num(r.quantity),
    unitCost: num(r.unit_cost),
    receivedQuantity: num(r.received_quantity ?? 0),
    note: opt(r.note as string | null),
  };
}

/** Órdenes de compra con sus líneas (las líneas quitadas de un borrador no llegan). */
export function ordersFromRows(orders: Row[], lines: Row[]): PurchaseOrder[] {
  return orders.map((r) => {
    const status = String(r.status);
    const received = String(r.received);
    return {
      id: String(r.id),
      number: String(r.number),
      supplier: String(r.supplier),
      date: String(r.date),
      status: status === "sent" || status === "invoiced" ? status : "draft",
      invoiceNumber: opt(r.invoice_number as string | null),
      invoiceAmount: r.invoice_amount === null || r.invoice_amount === undefined ? undefined : num(r.invoice_amount),
      invoiceDate: opt(r.invoice_date as string | null),
      paid: r.paid === true,
      received: received === "partial" || received === "yes" ? received : "no",
      notes: opt(r.notes as string | null),
      lines: lines.filter((l) => l.order_id === r.id && !l.removed_at).sort((a, b) => num(a.position) - num(b.position)).map(orderLineFromRow),
      createdBy: String(r.created_by ?? ""),
      createdAt: iso(r.created_at),
    };
  });
}

/** Argumento de compras_order_save (la base asigna el número y valida cada línea). */
export function orderToParams(id: string, d: { supplier: string; date: string; notes?: string; lines: Array<Omit<PurchaseOrderLine, "receivedQuantity"> & { receivedQuantity?: number }> }): Row {
  return {
    id,
    supplier: d.supplier,
    date: d.date,
    notes: d.notes ?? null,
    lines: d.lines.map((l) => ({
      id: l.id,
      project_id: l.projectId,
      budget_line_id: l.budgetLineId,
      material_id: l.materialId ?? null,
      material_name: l.materialName,
      unit: l.unit,
      quantity: l.quantity,
      unit_cost: l.unitCost,
      note: l.note ?? null,
    })),
  };
}

/** Órdenes de la demo para compras_load_orders (con su número, estado y recepciones). */
export function orderSeedRows(orders: PurchaseOrder[]): { orders: Row[]; lines: Row[] } {
  return {
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      supplier: o.supplier,
      date: o.date,
      status: o.status,
      invoice_number: o.invoiceNumber ?? null,
      invoice_amount: o.invoiceAmount ?? null,
      invoice_date: o.invoiceDate ?? null,
      paid: o.paid,
      received: o.received,
      notes: o.notes ?? null,
      created_by: o.createdBy,
      created_at: o.createdAt,
    })),
    lines: orders.flatMap((o) =>
      o.lines.map((l, i) => ({
        id: l.id,
        order_id: o.id,
        position: i,
        project_id: l.projectId,
        budget_line_id: l.budgetLineId,
        material_id: l.materialId ?? null,
        material_name: l.materialName,
        unit: l.unit,
        quantity: l.quantity,
        unit_cost: l.unitCost,
        received_quantity: l.receivedQuantity,
      })),
    ),
  };
}
