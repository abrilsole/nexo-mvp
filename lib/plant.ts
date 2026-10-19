// ─────────────────────────────────────────────────────────────
// Planta (Lote 5B) — funciones puras, sin importes.
// Asignaciones del Jefe de planta (producto + rubro + operario + día), carga de cada operario por día
// (misma regla de horas extra del Lote 4: splitOvertime), producto + rubro pendientes de asignar,
// desvío de horas por producto + rubro (con lo de cada operario) y las alertas de planta.
// Ver docs/PRODUCCION.md.
// ─────────────────────────────────────────────────────────────
import type { Alert, AlertSettings, DayException, Operator, Project, RubroId, WorkAssignment } from "@/types";
import { alertBase, alertResolutionKey } from "./alerts";
import { splitOvertime } from "./capacity";
import { rubroLabel } from "./rubros";
import { daysBetween, formatDate, formatNumber } from "./formatting";
import { calendarCell } from "./schedule";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Etapas en las que se asignan operarios (desde Aprobado hasta Instalación). */
export const ASSIGNABLE_STATUSES: Project["status"][] = ["approved", "purchasing", "production", "installation"];

export const isAssignable = (p: Pick<Project, "status" | "isClosed">) => !p.isClosed && ASSIGNABLE_STATUSES.includes(p.status);

// ── Fechas ────────────────────────────────────────────────────

function utc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, n: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes a viernes de la semana de `iso`. */
export function workWeek(iso: string): string[] {
  const dow = utc(iso).getUTCDay(); // 0 = domingo
  const monday = addDays(iso, dow === 0 ? -6 : 1 - dow);
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

// ── Lo que pide cada producto ─────────────────────────────────

export interface RubroNeed {
  projectId: string;
  itemId: string;
  itemName: string;
  rubro: RubroId;
  /** Horas estimadas por el Administrativo para el rubro del producto (toda la cantidad). */
  hours: number;
  /** Operarios que pide el rubro (sin nombre). */
  workers: number;
}

/** Rubros de cada producto del proyecto: horas estimadas y operarios pedidos. */
export function productNeeds(project: Pick<Project, "id" | "items">): RubroNeed[] {
  return project.items.flatMap((i) =>
    i.rubros.map((r) => ({ projectId: project.id, itemId: i.id, itemName: i.name, rubro: r.rubro, hours: r.hours, workers: r.workers })),
  );
}

// ── Asignaciones y carga por día ──────────────────────────────

export interface AssignmentInput {
  hourKind?: "labor" | "design" | "admin";
  projectId: string;
  /** Producto del proyecto. */
  itemId: string;
  rubro: RubroId;
  operatorId: string;
  date: string;
  plannedHours: number;
}

/** Problema con una asignación, o null si está bien. */
export function assignmentError(input: AssignmentInput, ctx: { projects: Project[]; operators: Operator[] }): string | null {
  const project = ctx.projects.find((p) => p.id === input.projectId);
  if (!project) return "Elegí un proyecto.";
  if (!isAssignable(project)) return "Solo se asignan proyectos entre Aprobado e Instalación.";
  const item = project.items.find((i) => i.id === input.itemId);
  if (!item) return "Elegí un producto del proyecto.";
  if (!item.rubros.some((r) => r.rubro === input.rubro)) return `${item.name} no tiene ese rubro: elegí uno de sus rubros.`;
  const operator = ctx.operators.find((o) => o.id === input.operatorId);
  if (!operator) return "Elegí un operario.";
  if (!operator.active) return `${operator.name} está dado de baja.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Elegí el día.";
  if (!(input.plannedHours > 0)) return "Las horas previstas tienen que ser mayores a cero.";
  if (input.plannedHours > 24) return "Un día tiene 24 h.";
  return null;
}

/** Días hábiles (lunes a viernes) entre `from` y `to`, inclusive. Máximo 60 días para no crear de más por error. */
export function workdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 60; d = addDays(d, 1)) {
    const dow = utc(d).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d);
  }
  return out;
}

export interface DayLoad {
  operatorId: string;
  date: string;
  planned: number;
  /** Lo que entra en la jornada (Configuración) y lo que serían horas extra (misma regla del Cotizador). */
  normalHours: number;
  overtimeHours: number;
  overloaded: boolean;
}

export function dayLoad(assignments: WorkAssignment[], operatorId: string, date: string, hoursPerDay: number): DayLoad {
  const planned = round2(assignments.filter((a) => a.operatorId === operatorId && a.date === date).reduce((s, a) => s + a.plannedHours, 0));
  const split = splitOvertime(planned, hoursPerDay);
  return { operatorId, date, planned, ...split, overloaded: split.overtimeHours > 0 };
}

export interface PendingRubro {
  projectId: string;
  projectCode: string;
  projectName: string;
  dueDate: string;
  itemId: string;
  itemName: string;
  rubro: RubroId;
  hours: number;
  workers: number;
  /** Operarios distintos asignados a ese producto y rubro (cualquier día). */
  assigned: number;
  missing: number;
  daysLeft: number;
}

/**
 * "Pendientes de asignar": producto + rubro donde se pidieron N operarios y hay menos personas asignadas.
 * Los productos terminados no cuentan. Cuando todo está asignado, la lista queda vacía.
 * Primero lo que se entrega antes.
 */
export function pendingAssignments(projects: Project[], assignments: WorkAssignment[], today: string): PendingRubro[] {
  const out: PendingRubro[] = [];
  for (const p of projects.filter(isAssignable)) {
    for (const need of productNeeds(p)) {
      const item = p.items.find((i) => i.id === need.itemId);
      if (item && item.completedUnits >= item.quantity) continue;
      const assigned = new Set(
        assignments.filter((a) => a.projectId === p.id && a.itemId === need.itemId && a.rubro === need.rubro).map((a) => a.operatorId),
      ).size;
      if (assigned >= need.workers) continue;
      out.push({
        projectId: p.id,
        projectCode: p.code,
        projectName: p.name,
        dueDate: p.dueDate,
        itemId: need.itemId,
        itemName: need.itemName,
        rubro: need.rubro,
        hours: need.hours,
        workers: need.workers,
        assigned,
        missing: need.workers - assigned,
        daysLeft: daysBetween(today, p.dueDate),
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.projectCode.localeCompare(b.projectCode) || a.itemName.localeCompare(b.itemName));
}

// ── Desvío de horas ───────────────────────────────────────────

export interface Threshold {
  pct: number;
  hours: number;
}

export const thresholdOf = (s: Pick<AlertSettings, "hoursDeviationPct" | "hoursDeviationHours">): Threshold => ({ pct: s.hoursDeviationPct, hours: s.hoursDeviationHours });

/** % por encima de lo previsto (null si no había nada previsto). */
export function overPct(expected: number, actual: number): number | null {
  return expected > 0 ? round2(((actual - expected) / expected) * 100) : null;
}

/** ¿Las horas reales superan las previstas por el umbral? Lo que ocurra primero: el % o las horas. */
export function exceeds(expected: number, actual: number, t: Threshold): boolean {
  const over = actual - expected;
  if (!(over > 0)) return false;
  const pct = overPct(expected, actual);
  return over >= t.hours || (pct !== null && pct >= t.pct);
}

export interface HoursRecord {
  entryId: string;
  date: string;
  operatorId?: string;
  worker: string;
  hours: number;
}

const laborEntries = (p: Project) => p.actualEntries.filter((e) => e.type === "labor" && e.labor);

const recordOf = (e: Project["actualEntries"][number]): HoursRecord => ({
  entryId: e.id,
  date: e.date,
  operatorId: e.operatorId,
  worker: e.labor?.workerName ?? "",
  hours: e.labor?.hours ?? 0,
});

/** Cómo le fue a un operario en un producto + rubro: horas previstas en sus asignaciones vs las que cargó. */
export type OperatorVerdict = "met" | "over" | "short" | "not_started";

export const VERDICT_LABELS: Record<OperatorVerdict, string> = {
  met: "Cumplió",
  over: "Se pasó",
  short: "Quedó corto",
  not_started: "Todavía no cargó",
};

export interface OperatorWork {
  operatorId: string;
  /** Previstas en las asignaciones que ya pasaron (las de hoy, solo si ya cargó). */
  planned: number;
  /** Previstas de hoy en adelante, todavía sin cargar. */
  upcoming: number;
  actual: number;
  /** Horas de más (positivo) o de menos (negativo) contra lo previsto. */
  diff: number;
  verdict: OperatorVerdict;
}

/** Margen para considerar que cumplió (redondeos de carga). */
const TOLERANCE = 0.01;

export function operatorVerdict(planned: number, actual: number): OperatorVerdict {
  if (planned <= 0 && actual <= 0) return "not_started";
  if (actual > planned + TOLERANCE) return "over";
  if (actual < planned - TOLERANCE) return "short";
  return "met";
}

export interface ProductRubroHours {
  projectId: string;
  itemId: string;
  itemName: string;
  rubro: RubroId;
  /** Estimadas para el producto y rubro (toda la cantidad). */
  estimated: number;
  actual: number;
  over: number;
  pct: number | null;
  /** Supera la estimación por el umbral de Configuración → Alertas. */
  flagged: boolean;
  workers: number;
  operators: OperatorWork[];
  records: HoursRecord[];
}

/**
 * Por producto + rubro: horas estimadas vs cargadas, y por cada operario asignado, previstas vs cargadas.
 * Cada número sale de registros concretos (`records`).
 */
export function productRubroHours(project: Project, assignments: WorkAssignment[], t: Threshold, today: string): ProductRubroHours[] {
  return productNeeds(project).map((need) => {
    const entries = laborEntries(project).filter((e) => e.itemId === need.itemId && e.rubro === need.rubro);
    const mine = assignments.filter((a) => a.projectId === project.id && a.itemId === need.itemId && a.rubro === need.rubro);
    const actual = round2(entries.reduce((s, e) => s + (e.labor?.hours ?? 0), 0));
    const operatorIds = [...new Set([...mine.map((a) => a.operatorId), ...entries.map((e) => e.operatorId).filter((x): x is string => !!x)])];
    const operators = operatorIds.map((operatorId): OperatorWork => {
      const loggedOn = (a: WorkAssignment) => entries.some((e) => e.assignmentId === a.id);
      const theirs = mine.filter((a) => a.operatorId === operatorId);
      const planned = round2(theirs.filter((a) => a.date < today || (a.date === today && loggedOn(a))).reduce((s, a) => s + a.plannedHours, 0));
      const upcoming = round2(theirs.filter((a) => a.date > today || (a.date === today && !loggedOn(a))).reduce((s, a) => s + a.plannedHours, 0));
      const done = round2(entries.filter((e) => e.operatorId === operatorId).reduce((s, e) => s + (e.labor?.hours ?? 0), 0));
      return { operatorId, planned, upcoming, actual: done, diff: round2(done - planned), verdict: operatorVerdict(planned, done) };
    });
    return {
      projectId: project.id,
      itemId: need.itemId,
      itemName: need.itemName,
      rubro: need.rubro,
      estimated: need.hours,
      actual,
      over: round2(actual - need.hours),
      pct: overPct(need.hours, actual),
      flagged: need.hours > 0 && exceeds(need.hours, actual, t),
      workers: need.workers,
      operators,
      records: entries.map(recordOf),
    };
  });
}

// ── Alertas de planta (sin importes) ──────────────────────────

const describe = (r: HoursRecord) => `${formatDate(r.date)} · ${r.worker} · ${formatNumber(r.hours)} h (registro ${r.entryId})`;
const signedPct = (pct: number | null) => (pct === null ? "" : `, +${formatNumber(pct, 0)} %`);

/** La alerta se vuelve a evaluar si el proyecto cambia o pasa el día (igual que el resto de las alertas). */
const withKey = (a: Omit<Alert, "resolutionKey">, p: Project, today: string): Alert => ({ ...a, resolutionKey: alertResolutionKey(a.id, p, today) });

export interface PlantContext {
  projects: Project[];
  assignments: WorkAssignment[];
  operators: Operator[];
  settings: AlertSettings;
  hoursPerDay: number;
  today: string;
  /** Excepciones de días laborales (Fase 3): definen la capacidad de cada día junto con los días del operario. */
  dayExceptions?: DayException[];
}

/**
 * Alertas de planta: desvío de horas del día, desvío acumulado del rubro, operario sobrecargado y rubro sin asignar
 * a pocos días del plazo. Las ven el Jefe de planta y el Administrativo; el Operario no.
 */
export function plantAlerts(ctx: PlantContext): Alert[] {
  const t = thresholdOf(ctx.settings);
  const name = (id: string) => ctx.operators.find((o) => o.id === id)?.name ?? "Operario";
  const byId = new Map(ctx.projects.map((p) => [p.id, p]));
  const alerts: Alert[] = [];

  for (const p of ctx.projects.filter((x) => !x.isClosed && x.status !== "quotation")) {
    for (const r of productRubroHours(p, ctx.assignments, t, ctx.today)) {
      if (!r.flagged) continue;
      const who = r.operators.filter((o) => o.actual > 0).map((o) => `${name(o.operatorId)} ${formatNumber(o.actual)} h${o.verdict === "over" ? ` (+${formatNumber(o.diff)} h sobre lo asignado)` : ""}`);
      alerts.push(
        withKey(
          {
            ...alertBase(p),
            id: `${p.id}:hours:${r.itemId}:${r.rubro}:${Math.round(r.actual)}`,
            kind: "hours",
            level: (r.pct ?? 0) >= 2 * t.pct ? "critical" : "warning",
            title: `${r.itemName} · ${rubroLabel(r.rubro)}: ${formatNumber(r.over)} h por encima de lo estimado`,
            message: `Se estimaron ${formatNumber(r.estimated)} h y se cargaron ${formatNumber(r.actual)} h (+${formatNumber(r.over)} h${signedPct(r.pct)}). Operarios: ${who.join(", ")}.`,
            records: r.records.map(describe),
          },
          p,
          ctx.today,
        ),
      );
    }
  }

  const days = [...new Set(ctx.assignments.filter((a) => a.date >= ctx.today).map((a) => `${a.operatorId}|${a.date}`))];
  for (const k of days) {
    const [operatorId, date] = k.split("|");
    const operator = ctx.operators.find((o) => o.id === operatorId) ?? { id: operatorId };
    const cell = calendarCell(operator, date, ctx.assignments, ctx.dayExceptions ?? [], ctx.hoursPerDay);
    if (!cell.over) continue;
    const mine = ctx.assignments.filter((a) => a.operatorId === operatorId && a.date === date).sort((a, b) => b.plannedHours - a.plannedHours);
    const p = byId.get(mine[0].projectId);
    if (!p) continue;
    alerts.push(
      withKey(
        {
          ...alertBase(p),
          id: `overload:${operatorId}:${date}`,
          kind: "overload",
          level: "warning",
          title: cell.capacity.working
            ? `${name(operatorId)} tiene ${formatNumber(cell.planned)} h asignadas el ${formatDate(date)}`
            : `${name(operatorId)} no trabaja el ${formatDate(date)} y tiene ${formatNumber(cell.planned)} h asignadas`,
          message: cell.capacity.working
            ? `Ese día puede ${formatNumber(cell.capacity.hours)} h (${cell.capacity.reason.toLowerCase()}): ${formatNumber(cell.overBy)} h de más.`
            : `${cell.capacity.reason}. Hay que reasignar esas horas.`,
          records: mine.map((a) => `${byId.get(a.projectId)?.code ?? a.projectId} · ${rubroLabel(a.rubro)} · ${formatNumber(a.plannedHours)} h`),
        },
        p,
        ctx.today,
      ),
    );
  }

  for (const r of pendingAssignments(ctx.projects, ctx.assignments, ctx.today)) {
    if (r.daysLeft > ctx.settings.dueSoonDays) continue;
    const p = byId.get(r.projectId);
    if (!p) continue;
    alerts.push(
      withKey(
        {
          ...alertBase(p),
          id: `${p.id}:unassigned:${r.itemId}:${r.rubro}`,
          kind: "unassigned",
          level: r.daysLeft < 0 ? "critical" : "warning",
          title: `${r.itemName} · ${rubroLabel(r.rubro)}: faltan operarios`,
          message: `Se piden ${r.workers} ${r.workers === 1 ? "operario" : "operarios"} y hay ${r.assigned} asignado${r.assigned === 1 ? "" : "s"}. ${
            r.daysLeft < 0 ? `La entrega venció hace ${-r.daysLeft} días.` : `Faltan ${r.daysLeft} días para la entrega.`
          }`,
        },
        p,
        ctx.today,
      ),
    );
  }
  return alerts;
}
