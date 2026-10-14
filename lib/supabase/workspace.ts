// ─────────────────────────────────────────────────────────────
// Lectura y escritura de la empresa (workspace) del usuario en Supabase.
// El store sigue aplicando operaciones puras en memoria; acá se persisten
// solo las partes que cambiaron (las operaciones son inmutables, así que
// alcanza con comparar referencias).
// ─────────────────────────────────────────────────────────────
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSettings, AppRole, CostSettings, HourRate, MaterialRequest, Operator, Project } from "@/types";
import { DEFAULT_FINANCIAL_PCT, DEFAULT_HOUR_RATES, DEFAULT_OVERTIME_MULTIPLIER, DEFAULT_SETTINGS } from "@/lib/constants";
import type { StockState } from "@/lib/stock";
import type { TallerCall } from "./taller";
import { deriveLedgerFromLegacy } from "@/lib/stock-legacy";
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
  type ChildKey,
} from "./mappers";

export interface WorkspaceData {
  projects: Project[];
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
  /** Solo Gestión: Taller recibe siempre el valor por defecto (nunca lee cost_settings). */
  costSettings: CostSettings;
  /** Tipos de hora con su tarifa. Solo Gestión: Taller recibe la lista por defecto sin usarla (nunca lee hour_rates). */
  hourRates: HourRate[];
  demoSeeded: boolean;
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
      .select("organization_id, display_name, role, organizations(name, demo_seeded, alert_settings)")
      .eq("user_id", user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ) as {
    organization_id: string;
    display_name: string;
    role: AppRole;
    organizations: { name: string; demo_seeded: boolean; alert_settings: AlertSettings | null } | null;
  } | null;
  if (!membership) throw new Error("Tu usuario no tiene una empresa asociada.");
  // Taller no lee las tablas (tienen costos): todo lo suyo llega por taller_workspace().
  if (membership.role === "operator") return loadTallerWorkspace(db, user, membership.display_name);
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
    organizationId: org,
    organizationName: membership.organizations.name,
    userId: user.id,
    userName: membership.display_name || user.email?.split("@")[0] || "Usuario",
    userEmail: user.email ?? "",
    role: membership.role,
    demoSeeded: membership.organizations.demo_seeded,
    costSettings,
    hourRates,
    projects: domainProjects,
    operators: operators.map(operatorFromRow),
    stock,
    requests: requests.map(requestFromRow),
    stockMigrated,
    settings: { ...DEFAULT_SETTINGS, ...(membership.organizations.alert_settings ?? {}) },
    resolvedAlertIds: resolved.map((r) => r.alert_id),
  };
}

export const DEFAULT_COST_SETTINGS: CostSettings = { overtimeMultiplier: DEFAULT_OVERTIME_MULTIPLIER, financialPct: DEFAULT_FINANCIAL_PCT };

/** Multiplicador de horas extra y gasto financiero de la empresa (tabla de Gestión). Sin fila → valores por defecto. */
async function loadCostSettings(db: SupabaseClient, org: string): Promise<CostSettings> {
  const { data, error } = await db.from("cost_settings").select("*").eq("organization_id", org).maybeSingle();
  // Si la tabla todavía no existe en la base, se usa el valor por defecto en lugar de romper la carga.
  if (error || !data) return { ...DEFAULT_COST_SETTINGS };
  return costSettingsFromRow(data as Record<string, unknown>);
}

/** Tipos de hora con su tarifa (tabla de Gestión). Sin filas → las tarifas iniciales. */
async function loadHourRates(db: SupabaseClient, org: string): Promise<HourRate[]> {
  const { data, error } = await db.from("hour_rates").select("*").eq("organization_id", org).order("position");
  if (error || !data || data.length === 0) return DEFAULT_HOUR_RATES.map((r) => ({ ...r }));
  return (data as Record<string, unknown>[]).map(hourRateFromRow);
}

/** Mensaje para un operario dado de baja que inicia sesión. */
export const INACTIVE_OPERATOR_MESSAGE =
  "Tu usuario de Taller fue dado de baja, así que ya no tiene acceso a los proyectos. Si es un error, pedile a Gestión que te reactive.";

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
}

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
    costSettings: { ...DEFAULT_COST_SETTINGS },
    hourRates: [],
    demoSeeded: true,
    stockMigrated: false,
    projects: projectsFromRows({
      projects: json.projects ?? [],
      budgetLines: [],
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
        { organization_id: org, overtime_multiplier: settings.overtimeMultiplier, financial_pct: settings.financialPct, updated_at: new Date().toISOString() },
        { onConflict: "organization_id" },
      ),
  );
}

export async function saveHourRates(db: SupabaseClient, org: string, rates: HourRate[]) {
  check(await db.from("hour_rates").upsert(rates.map((r, i) => hourRateToRow(org, r, i)), { onConflict: "organization_id,id" }));
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
}
