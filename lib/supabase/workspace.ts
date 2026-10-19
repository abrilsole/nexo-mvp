// ─────────────────────────────────────────────────────────────
// Lectura y escritura de la empresa (workspace) del usuario en Supabase.
// El store sigue aplicando operaciones puras en memoria; acá se persisten
// solo las partes que cambiaron (las operaciones son inmutables, así que
// alcanza con comparar referencias).
// ─────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSettings, AppRole, CostSettings, DayException, HourRate, MaterialRequest, Operator, PriceRecord, Project, PurchaseOrder, ValueCorrection, WorkAssignment } from "@/types";
import { DEFAULT_FINANCIAL_PCT, DEFAULT_HOUR_RATES, DEFAULT_HOURS_PER_DAY, DEFAULT_OVERTIME_MULTIPLIER, DEFAULT_SETTINGS } from "@/lib/constants";
import type { StockState } from "@/lib/stock";
import type { TallerCall } from "./taller";
import type { CorrectionInput, CorrectionReceipt } from "@/lib/corrections";
import { deriveLedgerFromLegacy } from "@/lib/stock-legacy";
import { todayISO } from "@/lib/formatting";
import { hourRatesAt, operatorsAt, OVERTIME_SUBJECT, valueAt } from "@/lib/price-history";
import {
  CHILD_TABLES,
  childrenToRows,
  lotFromRow,
  lotToRow,
  movementFromRow,
  movementToRow,
  operatorFromRow,
  operatorToRow,
  projectToRow,
  projectsFromRows,
  requestFromRow,
  requestToRow,
  costSettingsFromRow,
  hourRateFromRow,
  hourRateToRow,
  reusableFromRow,
  priceRecordFromRow,
  priceRecordToRow,
  correctionFromRow,
  assignmentFromRow,
  assignmentToParams,
  orderSeedRows,
  orderToParams,
  ordersFromRows,
  dayExceptionFromRow,
  type ChildKey,
} from "./mappers";

export interface WorkspaceData {
  reviewedHoursKeys?: string[];
  projects: Project[];
  /** Asignaciones del Jefe de planta (Lote 5B). Las lee Administrativo y Jefe de planta; el Operario, las suyas. */
  assignments: WorkAssignment[];
  /** Excepciones de días laborales por operario (Lote 6 · Fase 3). Las leen Administrativo y Jefe de planta. */
  dayExceptions?: DayException[];
  /** Órdenes de compra con sus líneas (Lote 6). Las leen Administrativo y Compras. */
  orders: PurchaseOrder[];
  operators: Operator[];
  stock: StockState;
  requests: MaterialRequest[];
  settings: AlertSettings;
  resolvedAlertIds: string[];
}

export interface Workspace extends WorkspaceData {
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: AppRole;
  /** Solo Administrativo: los demás roles reciben el valor por defecto (nunca leen cost_settings). */
  costSettings: CostSettings;
  /** Tipos de hora con la tarifa vigente hoy. Solo Administrativo (los demás roles nunca leen hour_rates). */
  hourRates: HourRate[];
  /** Historial de precios con vigencia. Administrativo: todo · Compras: solo precios de materiales · el resto: vacío. */
  priceHistory: PriceRecord[];
  /** Correcciones auditadas de valores congelados (solo Administrativo). */
  corrections: ValueCorrection[];
  demoSeeded: boolean;
  /** La empresa tiene cargados los datos de demostración (muestra "Restaurar datos demo"). */
  isDemo: boolean;
  /**
   * true si la empresa tenía datos del modelo anterior (compras, usos, sobrantes) y todavía no tenía
   * stock: el ledger se derivó en memoria y hay que guardarlo.
   */
  stockMigrated: boolean;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

async function selectAll(db: SupabaseClient, table: string, org: string) {
  return check(await db.from(table).select("*").eq("organization_id", org).order("position")) as Record<string, unknown>[];
}

export async function loadWorkspace(db: SupabaseClient): Promise<Workspace> {
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) throw new Error("Tu sesión expiró. Volvé a iniciar sesión.");
  const user = auth.user;

  const membership = check(
    await db
      .from("organization_members")
      .select("organization_id, display_name, role, can_view_commercial, deactivated_at, organizations(name, demo_seeded, is_demo, alert_settings)")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ) as {
    organization_id: string;
    display_name: string;
    role: AppRole;
    can_view_commercial: boolean;
    deactivated_at: string | null;
    organizations: { name: string; demo_seeded: boolean; is_demo: boolean; alert_settings: AlertSettings | null } | null;
  } | null;
  if (!membership) throw new Error("Tu usuario no tiene una empresa asociada.");
  // Operario, Compras y Jefe de planta no leen las tablas (tienen importes): lo suyo llega por su función.
  if (membership.role === "operator") return loadTallerWorkspace(db, user, membership.display_name);
  if (membership.deactivated_at) throw new Error(INACTIVE_USER_MESSAGE);
  if (membership.role === "member" && !membership.can_view_commercial) return loadStaffWorkspace(db, user, "jefe_planta");
  if (membership.role === "compras" || membership.role === "jefe_planta") return loadStaffWorkspace(db, user, membership.role);
  if (!membership.organizations) throw new Error("Tu usuario no tiene una empresa asociada.");

  const org = membership.organization_id;
  const [
    projects,
    budgetLines,
    purchaseEntries,
    materialUsages,
    actualEntries,
    activity,
    items,
    stageLogs,
    attachments,
    pool,
    operators,
    lots,
    movements,
    requests,
    resolved,
    costSettings,
    hourRates,
    priceHistory,
    corrections,
    assignments,
    orders,
    dayExceptions,
  ] = await Promise.all([
    check(await db.from("projects").select("*").eq("organization_id", org).order("created_at", { ascending: false })) as Record<
      string,
      unknown
    >[],
    selectAll(db, CHILD_TABLES.budgetLines, org),
    selectAll(db, CHILD_TABLES.purchaseEntries, org),
    selectAll(db, CHILD_TABLES.materialUsages, org),
    selectAll(db, CHILD_TABLES.actualEntries, org),
    selectAll(db, CHILD_TABLES.activity, org),
    selectAll(db, CHILD_TABLES.items, org),
    selectAll(db, CHILD_TABLES.stageLogs, org),
    selectAll(db, CHILD_TABLES.attachments, org),
    selectAll(db, "reusable_materials", org),
    selectAll(db, "operators", org),
    check(await db.from("stock_lots").select("*").eq("organization_id", org).order("created_at").order("id")) as Record<string, unknown>[],
    selectAll(db, "stock_movements", org),
    selectAll(db, "material_requests", org),
    check(await db.from("resolved_alerts").select("alert_id").eq("organization_id", org)) as { alert_id: string }[],
    loadCostSettings(db, org),
    loadHourRates(db, org),
    loadOptional(db, "price_history", org, priceRecordFromRow),
    loadOptional(db, "value_corrections", org, correctionFromRow),
    loadAssignments(db, org),
    loadOrders(db, org),
    loadDayExceptions(db, org),
  ]);

  const domainProjects = projectsFromRows({ projects, budgetLines, purchaseEntries, materialUsages, actualEntries, activity, items, stageLogs, attachments });
  let stock: StockState = { lots: lots.map(lotFromRow), movements: movements.map(movementFromRow) };
  let stockMigrated = false;
  const hasLegacy = pool.length > 0 || domainProjects.some((p) => p.purchaseEntries.length > 0 || p.materialUsages.length > 0);
  if (stock.lots.length === 0 && stock.movements.length === 0 && hasLegacy) {
    // Empresa con datos del modelo anterior: se traducen a lotes y movimientos (sin tocar lo original).
    stock = deriveLedgerFromLegacy(domainProjects, pool.map(reusableFromRow));
    stockMigrated = true;
  }

  return {
    reviewedHoursKeys: (await loadOptional(db, "hours_reviews", org, r => String(r.review_key))),
    organizationId: org,
    organizationName: membership.organizations.name,
    userId: user.id,
    userName: membership.display_name || user.email?.split("@")[0] || "Usuario",
    userEmail: user.email ?? "",
    role: membership.role,
    demoSeeded: membership.organizations.demo_seeded,
    isDemo: membership.organizations.is_demo,
    // Valores vigentes HOY (un cambio con fecha futura todavía no aplica).
    costSettings: { ...costSettings, overtimeMultiplier: valueAt(priceHistory, "overtime_multiplier", OVERTIME_SUBJECT, todayISO(), costSettings.overtimeMultiplier) },
    hourRates: hourRatesAt(hourRates, priceHistory, todayISO()),
    priceHistory,
    corrections,
    assignments,
    orders,
    dayExceptions,
    projects: domainProjects,
    operators: operatorsAt(operators.map(operatorFromRow), priceHistory, todayISO()),
    stock,
    requests: requests.map(requestFromRow),
    stockMigrated,
    settings: { ...DEFAULT_SETTINGS, ...(membership.organizations.alert_settings ?? {}) },
    resolvedAlertIds: resolved.map((r) => r.alert_id),
  };
}

export const DEFAULT_COST_SETTINGS: CostSettings = {
  overtimeMultiplier: DEFAULT_OVERTIME_MULTIPLIER,
  financialPct: DEFAULT_FINANCIAL_PCT,
  hoursPerDay: DEFAULT_HOURS_PER_DAY,
  laborValuation: "operator",
};

/** Asignaciones vigentes (las quitadas quedan en la base con removed_at). Sin la tabla todavía: lista vacía. */
async function loadAssignments(db: SupabaseClient, org: string): Promise<WorkAssignment[]> {
  const { data, error } = await db.from("work_assignments").select("*").eq("organization_id", org).is("removed_at", null).order("date");
  if (error) throw new Error(error.message);
  if (!data) return [];
  return (data as Record<string, unknown>[]).map(assignmentFromRow);
}

/** Órdenes de compra y sus líneas (sin las tablas todavía: lista vacía). */
/** Excepciones de días laborales vigentes (las quitadas quedan con removed_at). Sin la tabla todavía: lista vacía. */
async function loadDayExceptions(db: SupabaseClient, org: string): Promise<DayException[]> {
  const { data, error } = await db.from("operator_day_exceptions").select("*").eq("organization_id", org).is("removed_at", null).order("date");
  if (error) throw new Error(error.message);
  if (!data) return [];
  return (data as Record<string, unknown>[]).map(dayExceptionFromRow);
}

async function loadOrders(db: SupabaseClient, org: string): Promise<PurchaseOrder[]> {
  const [o, l] = await Promise.all([
    db.from("purchase_orders").select("*").eq("organization_id", org).order("number"),
    db.from("purchase_order_lines").select("*").eq("organization_id", org).is("removed_at", null).order("position"),
  ]);
  if (o.error || l.error) throw new Error((o.error ?? l.error)!.message);
  if (!o.data || !l.data) return [];
  return ordersFromRows(o.data as Row[], l.data as Row[]);
}

/** Tabla de Administrativo que puede no existir todavía en la base (migración pendiente): sin ella, lista vacía. */
async function loadOptional<T>(db: SupabaseClient, table: string, org: string, map: (r: Record<string, unknown>) => T): Promise<T[]> {
  const { data, error } = await db.from(table).select("*").eq("organization_id", org);
  if (error) throw new Error(error.message);
  if (!data) return [];
  return (data as Record<string, unknown>[]).map(map);
}

/** Multiplicador de horas extra, gasto financiero y jornada de la empresa (tabla de Gestión). Sin fila → valores por defecto. */
async function loadCostSettings(db: SupabaseClient, org: string): Promise<CostSettings> {
  const { data, error } = await db.from("cost_settings").select("*").eq("organization_id", org).maybeSingle();
  // Si la tabla todavía no existe en la base, se usa el valor por defecto en lugar de romper la carga.
  if (error) throw new Error(error.message);
  if (!data) return { ...DEFAULT_COST_SETTINGS };
  return costSettingsFromRow(data as Record<string, unknown>);
}

/** Tipos de hora con su tarifa (tabla de Gestión). Sin filas → las tarifas iniciales. */
async function loadHourRates(db: SupabaseClient, org: string): Promise<HourRate[]> {
  const { data, error } = await db.from("hour_rates").select("*").eq("organization_id", org).order("position");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return DEFAULT_HOUR_RATES.map((r) => ({ ...r }));
  return (data as Record<string, unknown>[]).map(hourRateFromRow);
}

/** Mensaje para un operario dado de baja que inicia sesión. */
export const INACTIVE_OPERATOR_MESSAGE =
  "Tu usuario de Operario fue dado de baja, así que ya no tiene acceso a los proyectos. Si es un error, pedile a un usuario Administrativo que te reactive.";

/** Mensaje para cualquier otra cuenta dada de baja. */
export const INACTIVE_USER_MESSAGE =
  "Tu usuario fue dado de baja, así que ya no tiene acceso a los datos de la empresa. Si es un error, pedile a un usuario Administrativo que te reactive.";

type Row = Record<string, unknown>;

interface TallerWorkspaceJson {
  status: "active" | "inactive";
  organization_id?: string;
  organization_name?: string;
  operator?: Row;
  projects?: Row[];
  project_items?: Row[];
  stage_logs?: Row[];
  attachments?: Row[];
  actual_entries?: Row[];
  stock_lots?: Row[];
  stock_movements?: Row[];
  material_requests?: Row[];
  assignments?: Row[];
  project_rubros?: Array<{ project_id: string; rubro: string }>;
  hours_per_day?: number | string;
}

/**
 * Rubros de los proyectos del operario: llegan solo como nombre (ni horas estimadas ni costos). En memoria se
 * guardan como líneas de mano de obra sin cantidad ni importe, para elegir el rubro al cargar horas.
 */
function rubroLines(list: Array<{ project_id: string; rubro: string }> | undefined): Row[] {
  return (list ?? []).map((r, i) => ({
    id: `rubro-${r.project_id}-${r.rubro}`,
    project_id: r.project_id,
    position: i,
    category: "labor",
    rubro: r.rubro,
    description: r.rubro,
    quantity: null,
    unit: "h",
    unit_cost: 0,
    total: 0,
  }));
}

const hoursPerDayOf = (v: number | string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : DEFAULT_HOURS_PER_DAY;
};

/** Workspace de un operario: solo sus proyectos asignados, sin costos, precios ni márgenes. */
async function loadTallerWorkspace(db: SupabaseClient, user: { id: string; email?: string }, displayName: string): Promise<Workspace> {
  const json = check(await db.rpc("taller_workspace")) as TallerWorkspaceJson;
  if (json.status !== "active" || !json.organization_id || !json.operator) throw new Error(INACTIVE_OPERATOR_MESSAGE);
  const operator = operatorFromRow(json.operator);
  return {
    organizationId: json.organization_id,
    organizationName: json.organization_name ?? "",
    userId: user.id,
    userName: operator.name || displayName || user.email?.split("@")[0] || "Operario",
    userEmail: user.email ?? "",
    role: "operator",
    // De costos, solo la jornada (para avisar si se pasa): nada económico.
    costSettings: { ...DEFAULT_COST_SETTINGS, hoursPerDay: hoursPerDayOf(json.hours_per_day) },
    hourRates: [],
    priceHistory: [],
    corrections: [],
    assignments: (json.assignments ?? []).map(assignmentFromRow),
    orders: [],
    demoSeeded: true,
    isDemo: false,
    stockMigrated: false,
    projects: projectsFromRows({
      projects: json.projects ?? [],
      budgetLines: rubroLines(json.project_rubros),
      purchaseEntries: [],
      materialUsages: [],
      actualEntries: json.actual_entries ?? [],
      activity: [],
      items: json.project_items ?? [],
      stageLogs: json.stage_logs ?? [],
      attachments: json.attachments ?? [],
    }),
    operators: [operator],
    stock: { lots: (json.stock_lots ?? []).map(lotFromRow), movements: (json.stock_movements ?? []).map(movementFromRow) },
    requests: (json.material_requests ?? []).map(requestFromRow),
    settings: { ...DEFAULT_SETTINGS },
    resolvedAlertIds: [],
  };
}

interface StaffWorkspaceJson {
  status: "active" | "inactive";
  organization_id?: string;
  organization_name?: string;
  display_name?: string;
  projects?: Row[];
  budget_lines?: Row[];
  purchase_entries?: Row[];
  material_usages?: Row[];
  actual_entries?: Row[];
  operators?: Row[];
  project_items?: Row[];
  stage_logs?: Row[];
  stock_lots?: Row[];
  stock_movements?: Row[];
  material_requests?: Row[];
  price_history?: Row[];
  assignments?: Row[];
  purchase_orders?: Row[];
  purchase_order_lines?: Row[];
  day_exceptions?: Row[];
  hours_per_day?: number | string;
  alert_settings?: Partial<AlertSettings> | null;
}

/**
 * Las funciones de Compras y Jefe de planta NO devuelven los importes que esos roles no pueden ver.
 * En memoria esos campos quedan en 0 para que el modelo esté completo; sus pantallas no los muestran.
 */
const withZeros = (rows: Row[] | undefined, zeros: Row): Row[] => (rows ?? []).map((r) => ({ ...zeros, ...r }));

/** Workspace de Compras o Jefe de planta, desde su función (compras_workspace / planta_workspace). */
async function loadStaffWorkspace(db: SupabaseClient, user: { id: string; email?: string }, role: "compras" | "jefe_planta"): Promise<Workspace> {
  const json = check(await db.rpc(role === "compras" ? "compras_workspace" : "planta_workspace")) as StaffWorkspaceJson;
  if (json.status !== "active" || !json.organization_id) throw new Error(INACTIVE_USER_MESSAGE);
  const projects = withZeros(json.projects, { sales_price: 0, progress_percent: 0, baseline: null });
  const actualEntries = (json.actual_entries ?? []).map((r) => ({ ...r, amount: 0, labor: { ...((r.labor as Row | null) ?? {}), hourlyCost: 0 } }));
  return {
    organizationId: json.organization_id,
    organizationName: json.organization_name ?? "",
    userId: user.id,
    userName: json.display_name || user.email?.split("@")[0] || "Usuario",
    userEmail: user.email ?? "",
    role,
    reviewedHoursKeys: await loadOptional(db, "hours_reviews", json.organization_id, r => String(r.review_key)),
    costSettings: { ...DEFAULT_COST_SETTINGS, hoursPerDay: hoursPerDayOf(json.hours_per_day) },
    hourRates: [],
    priceHistory: (json.price_history ?? []).map(priceRecordFromRow),
    corrections: [],
    assignments: (json.assignments ?? []).map(assignmentFromRow),
    orders: ordersFromRows(json.purchase_orders ?? [], json.purchase_order_lines ?? []),
    dayExceptions: (json.day_exceptions ?? []).map(dayExceptionFromRow),
    demoSeeded: true,
    isDemo: false,
    stockMigrated: false,
    projects: projectsFromRows({
      projects,
      // Compras: líneas de materiales con su costo · Jefe de planta: mano de obra sin importes (en 0).
      budgetLines: withZeros(json.budget_lines, { unit_cost: 0, total: 0 }),
      purchaseEntries: json.purchase_entries ?? [],
      materialUsages: json.material_usages ?? [],
      actualEntries,
      activity: [],
      items: json.project_items ?? [],
      stageLogs: json.stage_logs ?? [],
      attachments: [],
    }),
    operators: withZeros(json.operators, { hourly_cost: 0 }).map(operatorFromRow),
    stock: { lots: (json.stock_lots ?? []).map(lotFromRow), movements: (json.stock_movements ?? []).map(movementFromRow) },
    requests: (json.material_requests ?? []).map(requestFromRow),
    settings: { ...DEFAULT_SETTINGS, ...(json.alert_settings ?? {}) },
    resolvedAlertIds: [],
  };
}

/** Escrituras de un operario: una llamada a la función de Taller por cada registro nuevo. */
export async function runTallerCalls(db: SupabaseClient, calls: TallerCall[]) {
  for (const c of calls) check(await db.rpc(c.fn, { p: c.p }));
}

// ── Escrituras ────────────────────────────────────────────

/** Upsert de una lista completa + borrado de los ids que ya no están. */
async function replaceList(db: SupabaseClient, table: string, rows: Record<string, unknown>[], removedIds: string[], org: string) {
  if (rows.length) check(await db.from(table).upsert(rows, { onConflict: "organization_id,id" }));
  if (removedIds.length) check(await db.from(table).delete().eq("organization_id", org).in("id", removedIds));
}

function removed<T extends { id: string }>(prev: T[] | undefined, next: T[]): string[] {
  if (!prev) return [];
  const keep = new Set(next.map((x) => x.id));
  return prev.filter((x) => !keep.has(x.id)).map((x) => x.id);
}

const CHILD_KEYS = Object.keys(CHILD_TABLES) as ChildKey[];

export async function syncProject(db: SupabaseClient, org: string, prev: Project | undefined, next: Project) {
  check(await db.from("projects").upsert(projectToRow(org, next), { onConflict: "organization_id,id" }));
  for (const key of CHILD_KEYS) {
    if (prev && prev[key] === next[key]) continue;
    const items = next[key] as { id: string }[];
    await replaceList(db, CHILD_TABLES[key], childrenToRows(key, org, next.id, next[key]), removed(prev?.[key] as { id: string }[], items), org);
  }
}

/** El ledger de stock sólo crece: se insertan los lotes y movimientos nuevos. */
export async function syncStock(db: SupabaseClient, org: string, prev: StockState, next: StockState) {
  if (prev === next) return;
  const knownLots = new Set(prev.lots.map((l) => l.id));
  const knownMovs = new Set(prev.movements.map((m) => m.id));
  const lots = next.lots.filter((l) => !knownLots.has(l.id));
  const movs = next.movements.map((m, i) => ({ m, i })).filter(({ m }) => !knownMovs.has(m.id));
  if (lots.length) check(await db.from("stock_lots").upsert(lots.map((l) => lotToRow(org, l)), { onConflict: "organization_id,id" }));
  if (movs.length) {
    check(
      await db
        .from("stock_movements")
        .upsert(movs.map(({ m, i }) => movementToRow(org, m, i)), { onConflict: "organization_id,id" }),
    );
  }
}

export async function syncOperators(db: SupabaseClient, org: string, prev: Operator[], next: Operator[]) {
  if (prev === next) return;
  const before = new Map(prev.map((o) => [o.id, o]));
  const changed = next.map((o, i) => ({ o, i })).filter(({ o }) => before.get(o.id) !== o);
  if (changed.length) {
    check(await db.from("operators").upsert(changed.map(({ o, i }) => operatorToRow(org, o, i)), { onConflict: "organization_id,id" }));
  }
  // Eliminación definitiva (solo operarios sin horas registradas: lo valida lib/operators).
  const kept = new Set(next.map((o) => o.id));
  const removed = prev.filter((o) => !kept.has(o.id)).map((o) => o.id);
  if (removed.length) {
    check(await db.from("operators").delete().eq("organization_id", org).in("id", removed));
  }
}

export async function syncRequests(db: SupabaseClient, org: string, prev: MaterialRequest[], next: MaterialRequest[]) {
  if (prev === next) return;
  const before = new Map(prev.map((q) => [q.id, q]));
  const changed = next.map((q, i) => ({ q, i })).filter(({ q }) => before.get(q.id) !== q);
  if (changed.length) {
    check(await db.from("material_requests").upsert(changed.map(({ q, i }) => requestToRow(org, q, i)), { onConflict: "organization_id,id" }));
  }
}

export async function saveSettings(db: SupabaseClient, org: string, settings: AlertSettings) {
  check(await db.from("organizations").update({ alert_settings: settings }).eq("id", org));
}

export async function saveCostSettings(db: SupabaseClient, org: string, settings: CostSettings) {
  check(
    await db
      .from("cost_settings")
      .upsert(
        {
          organization_id: org,
          overtime_multiplier: settings.overtimeMultiplier,
          financial_pct: settings.financialPct,
          hours_per_day: settings.hoursPerDay,
          labor_valuation: settings.laborValuation,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      ),
  );
}

export async function saveHourRates(db: SupabaseClient, org: string, rates: HourRate[]) {
  check(await db.from("hour_rates").upsert(rates.map((r, i) => hourRateToRow(org, r, i)), { onConflict: "organization_id,id" }));
}

/** Crea o modifica una asignación (Administrativo o Jefe de planta; la base valida). */
export async function saveAssignment(db: SupabaseClient, a: WorkAssignment) {
  check(await db.rpc("planta_save_assignment", { p: assignmentToParams(a) }));
}

/** Asignación de la demo para planta_load_assignments (con quién y cuándo la creó). */
const assignmentSeedRow = (a: WorkAssignment) => ({ ...assignmentToParams(a), created_by: a.createdBy, created_at: a.createdAt });

/** Unidades terminadas de un producto (Jefe de planta o Administrativo; la base valida el rango). */
export async function setCompletedUnits(db: SupabaseClient, projectId: string, itemId: string, units: number) {
  check(await db.rpc("planta_set_completed_units", { p: { project_id: projectId, item_id: itemId, units } }));
}

/** Días laborales y excepciones de un operario (Jefe de planta o Administrativo). */
export async function saveSchedule(db: SupabaseClient, operatorId: string, change: ScheduleChange) {
  check(await db.rpc("planta_save_schedule", { p: scheduleParams(operatorId, change) }));
}

export interface ScheduleChange {
  workDays?: number[];
  add?: Array<Pick<DayException, "date" | "works" | "hours" | "note">>;
  remove?: string[];
}

export function scheduleParams(operatorId: string, c: ScheduleChange): Record<string, unknown> {
  return {
    operator_id: operatorId,
    ...(c.workDays ? { work_days: c.workDays } : {}),
    exceptions: (c.add ?? []).map((x) => ({ date: x.date, works: x.works, hours: x.hours ?? null, note: x.note ?? null })),
    removed: c.remove ?? [],
  };
}

/** Quita una asignación (queda marcada en la base, no se borra). */
export async function removeAssignment(db: SupabaseClient, id: string) {
  check(await db.rpc("planta_remove_assignment", { p_id: id }));
}

/** Crea o modifica una orden en Borrador (la base asigna el número y valida cada línea). */
export async function saveOrder(db: SupabaseClient, order: PurchaseOrder) {
  check(await db.rpc("compras_order_save", { p: orderToParams(order.id, order) }));
}

/** Enviar, facturar, pagada o recibir: la base valida la transición y crea las compras reales y el stock. */
export async function orderStatus(db: SupabaseClient, p: Record<string, unknown>) {
  check(await db.rpc("compras_order_status", { p }));
}

/** El historial de precios solo crece: se insertan los registros nuevos. */
export async function addPriceRecords(db: SupabaseClient, org: string, records: PriceRecord[]) {
  if (records.length) check(await db.from("price_history").insert(records.map((r) => priceRecordToRow(org, r))));
}

export interface CorrectionRequest {
  projectId: string;
  target: ValueCorrection["target"];
  field: ValueCorrection["field"];
  lineId?: string;
  newValue: number;
  reason: string;
}

/** Corrección de un valor congelado: la hace el servidor (admin_correct_value) y deja el registro. */
export async function correctValue(db: SupabaseClient, projectId: string, input: CorrectionInput): Promise<CorrectionReceipt> {
  const res = check(
    await db.rpc("admin_correct_value", {
      p: { project_id: projectId, target: input.target, field: input.field, line_id: input.lineId ?? null, new_value: input.newValue, reason: input.reason },
    }),
  ) as { id: string; corrected_at: string; corrected_by: string; old_value: number | string | null; description: string; activity_id: string; message: string };
  return {
    id: res.id,
    correctedAt: new Date(res.corrected_at).toISOString(),
    correctedBy: res.corrected_by,
    oldValue: res.old_value === null ? null : Number(res.old_value),
    description: res.description,
    activityId: res.activity_id,
    message: res.message,
  };
}

export async function setAlertResolved(db: SupabaseClient, org: string, alertId: string, resolved: boolean) {
  if (resolved) {
    check(await db.from("resolved_alerts").upsert({ organization_id: org, alert_id: alertId }, { onConflict: "organization_id,alert_id" }));
  } else {
    check(await db.from("resolved_alerts").delete().eq("organization_id", org).eq("alert_id", alertId));
  }
}

/**
 * Filas de toda la empresa, por tabla, para reset_workspace (seed demo o vaciar).
 * El servidor fuerza la empresa del usuario en cada fila.
 */
export function workspacePayload(org: string, data: WorkspaceData | null): Record<string, unknown> {
  if (!data) return { settings: DEFAULT_SETTINGS };
  const payload: Record<string, unknown> = {
    operators: data.operators.map((o, i) => operatorToRow(org, o, i)),
    projects: data.projects.map((p) => projectToRow(org, p)),
    stock_lots: data.stock.lots.map((l) => lotToRow(org, l)),
    stock_movements: data.stock.movements.map((m, i) => movementToRow(org, m, i)),
    material_requests: data.requests.map((q, i) => requestToRow(org, q, i)),
    resolved_alerts: data.resolvedAlertIds.map((alert_id) => ({ organization_id: org, alert_id })),
    settings: data.settings,
  };
  for (const key of CHILD_KEYS) payload[CHILD_TABLES[key]] = data.projects.flatMap((p) => childrenToRows(key, org, p.id, p[key]));
  return payload;
}

/**
 * Borra todos los datos de la empresa y, si se pasa `data`, carga ese contenido (seed demo).
 * Corre en el servidor en una sola transacción (reset_workspace): solo Gestión puede hacerlo.
 */
export async function replaceWorkspace(db: SupabaseClient, org: string, data: WorkspaceData | null) {
  check(await db.rpc("reset_workspace", { p_data: workspacePayload(org, data) }));
  // Las asignaciones de la demo se cargan con la misma función que usa el Jefe de planta.
  if (data?.assignments.length) check(await db.rpc("planta_load_assignments", { p: { assignments: data.assignments.map(assignmentSeedRow) } }));
  // Las órdenes de compra de la demo, con su número y estado (las compras reales y el stock ya vienen en el resto).
  if (data?.orders.length) check(await db.rpc("compras_load_orders", { p: orderSeedRows(data.orders) }));
  // Excepciones de días laborales de la demo (los días de cada operario ya vienen en operators).
  for (const opId of new Set((data?.dayExceptions ?? []).map((x) => x.operatorId))) {
    const exceptions = (data?.dayExceptions ?? []).filter((x) => x.operatorId === opId);
    check(await db.rpc("planta_save_schedule", { p: scheduleParams(opId, { add: exceptions }) }));
  }
  // Con la demo cargada la empresa queda como demo; al vaciar, deja de serlo.
  check(await db.from("organizations").update({ is_demo: data !== null }).eq("id", org));
}

/** Delta de una operación: no vuelve a escribir registros históricos ajenos al cambio. */
export function commitPayload(org: string, prev: Pick<WorkspaceData,"projects"|"stock"|"operators"|"requests">, next: Pick<WorkspaceData,"projects"|"stock"|"operators"|"requests">) {
  const tables: Record<string,{rows:Record<string,unknown>[];removed:string[]}> = {};
  const put = <T extends {id:string}>(table:string, before:T[], after:T[], map:(value:T,index:number)=>Record<string,unknown>) => {
    const old = new Map(before.map(x=>[x.id,x]));
    const rows=after.flatMap((x,i)=>old.get(x.id) === x ? [] : [map(x,i)]);
    const ids=removed(before,after);
    if (rows.length || ids.length) { const prior=tables[table]; tables[table]={rows:[...(prior?.rows ?? []),...rows],removed:[...(prior?.removed ?? []),...ids]}; }
  };
  const expected_projects: Array<{id:string;updated_at:string|null}> = [];
  for(const project of next.projects) {
    const before=prev.projects.find(p=>p.id === project.id);
    if(before === project) continue;
    expected_projects.push({id:project.id,updated_at:before?.updatedAt ?? null});
    tables.projects ??= {rows:[],removed:[]};tables.projects.rows.push(projectToRow(org,project));
    for(const key of CHILD_KEYS) {
      const rows=childrenToRows(key,org,project.id,project[key]);
      put(CHILD_TABLES[key],(before?.[key] ?? []) as {id:string}[],project[key] as {id:string}[],(_,i)=>rows[i]);
    }
  }
  put("operators",prev.operators,next.operators,(o,i)=>operatorToRow(org,o,i));
  put("stock_lots",prev.stock.lots,next.stock.lots,l=>lotToRow(org,l));
  put("stock_movements",prev.stock.movements,next.stock.movements,(m,i)=>movementToRow(org,m,i));
  put("material_requests",prev.requests,next.requests,(r,i)=>requestToRow(org,r,i));
  return {expected_projects,tables};
}
export async function commitChange(db:SupabaseClient,org:string,prev:Pick<WorkspaceData,"projects"|"stock"|"operators"|"requests">,next:Pick<WorkspaceData,"projects"|"stock"|"operators"|"requests">) {
  check(await db.rpc("admin_commit_change",{p:commitPayload(org,prev,next)}));
}
