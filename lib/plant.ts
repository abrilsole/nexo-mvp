// ─────────────────────────────────────────────────────────────
// Planta (Lote 5B) — funciones puras, sin importes.
// Asignaciones del Jefe de planta, carga de cada operario por día (con la misma regla de
// horas extra del Lote 4: splitOvertime), rubros pendientes de asignar, desvío de horas
// (reales vs previstas en la asignación del día y vs estimadas en el presupuesto del rubro)
// y las alertas de planta. Ver docs/PLANTA_Y_HORAS.md.
// ─────────────────────────────────────────────────────────────
import type { Alert, AlertSettings, Operator, Project, RubroId, WorkAssignment } from "@/types";
import { alertBase, alertResolutionKey } from "./alerts";
import { splitOvertime } from "./capacity";
import { rubroLabel } from "./rubros";
import { daysBetween, formatDate, formatNumber } from "./formatting";

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

// ── Horas por rubro del presupuesto ───────────────────────────

/** "(2 operarios × 40 h)" en la descripción de las líneas de mano de obra del Cotizador. */
const WORKERS_IN_TEXT = /\((\d+) operarios? ×/;

export interface RubroNeed {
  rubro: RubroId;
  /** Horas de mano de obra estimadas en el presupuesto (normales + extra). */
  hours: number;
  /** Operarios que pidió el Cotizador para el rubro. */
  workers: number;
}

/** Mano de obra que pidió el presupuesto, por rubro: horas estimadas y cantidad de operarios. */
export function laborNeeds(project: Pick<Project, "budgetLines">): RubroNeed[] {
  const map = new Map<RubroId, RubroNeed>();
  for (const l of project.budgetLines) {
    if (l.category !== "labor" || !l.rubro || l.quantity === null) continue;
    const workers = l.workers ?? Number(WORKERS_IN_TEXT.exec(l.description)?.[1] ?? 1);
    const cur = map.get(l.rubro) ?? { rubro: l.rubro, hours: 0, workers: 0 };
    map.set(l.rubro, { rubro: l.rubro, hours: round2(cur.hours + l.quantity), workers: Math.max(cur.workers, workers) });
  }
  return [...map.values()];
}

// ── Asignaciones y carga por día ──────────────────────────────

export interface AssignmentInput {
  projectId: string;
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
  const operator = ctx.operators.find((o) => o.id === input.operatorId);
  if (!operator) return "Elegí un operario.";
  if (!operator.active) return `${operator.name} está dado de baja.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Elegí el día.";
  if (!(input.plannedHours > 0)) return "Las horas previstas tienen que ser mayores a cero.";
  if (input.plannedHours > 24) return "Un día tiene 24 h.";
  return null;
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
  rubro: RubroId;
  workers: number;
  assigned: number;
  missing: number;
  daysLeft: number;
}

/**
 * Rubros donde el Cotizador pidió N operarios y hay menos asignados (desde hoy en adelante),
 * con prioridad por fecha de entrega.
 */
export function pendingAssignments(projects: Project[], assignments: WorkAssignment[], today: string): PendingRubro[] {
  const out: PendingRubro[] = [];
  for (const p of projects.filter(isAssignable)) {
    for (const need of laborNeeds(p)) {
      const assigned = new Set(assignments.filter((a) => a.projectId === p.id && a.rubro === need.rubro && a.date >= today).map((a) => a.operatorId)).size;
      if (assigned >= need.workers) continue;
      out.push({
        projectId: p.id,
        projectCode: p.code,
        projectName: p.name,
        dueDate: p.dueDate,
        rubro: need.rubro,
        workers: need.workers,
        assigned,
        missing: need.workers - assigned,
        daysLeft: daysBetween(today, p.dueDate),
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.projectCode.localeCompare(b.projectCode));
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

export interface DayDeviation {
  date: string;
  operatorId: string;
  projectId: string;
  rubro: RubroId;
  planned: number;
  actual: number;
  over: number;
  pct: number | null;
  flagged: boolean;
  records: HoursRecord[];
  assignmentIds: string[];
}

/** Por asignación del día: horas previstas vs horas cargadas ese día por ese operario en ese proyecto y rubro. */
export function dayDeviations(projects: Project[], assignments: WorkAssignment[], t: Threshold): DayDeviation[] {
  const groups = new Map<string, WorkAssignment[]>();
  for (const a of assignments) {
    const k = [a.date, a.operatorId, a.projectId, a.rubro].join("|");
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const out: DayDeviation[] = [];
  for (const list of groups.values()) {
    const { date, operatorId, projectId, rubro } = list[0];
    const project = projects.find((p) => p.id === projectId);
    if (!project) continue;
    const ids = new Set(list.map((a) => a.id));
    const entries = laborEntries(project).filter(
      (e) => (e.assignmentId && ids.has(e.assignmentId)) || (!e.assignmentId && e.date === date && e.operatorId === operatorId && e.rubro === rubro),
    );
    if (entries.length === 0) continue; // todavía no cargó: no es un desvío
    const planned = round2(list.reduce((s, a) => s + a.plannedHours, 0));
    const actual = round2(entries.reduce((s, e) => s + (e.labor?.hours ?? 0), 0));
    out.push({
      date,
      operatorId,
      projectId,
      rubro,
      planned,
      actual,
      over: round2(actual - planned),
      pct: overPct(planned, actual),
      flagged: exceeds(planned, actual, t),
      records: entries.map(recordOf),
      assignmentIds: list.map((a) => a.id),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export interface RubroHours {
  projectId: string;
  rubro: RubroId | null;
  /** Estimadas en el presupuesto (0 si el rubro no tenía mano de obra). */
  estimated: number;
  actual: number;
  over: number;
  pct: number | null;
  flagged: boolean;
  records: HoursRecord[];
}

/** Acumulado por rubro: horas estimadas en el presupuesto vs horas reales cargadas. Sin rubro → `rubro: null`. */
export function rubroHours(project: Project, t: Threshold): RubroHours[] {
  const needs = laborNeeds(project);
  const keys = new Set<RubroId | null>([...needs.map((n) => n.rubro), ...laborEntries(project).map((e) => e.rubro ?? null)]);
  return [...keys].map((rubro) => {
    const estimated = needs.find((n) => n.rubro === rubro)?.hours ?? 0;
    const entries = laborEntries(project).filter((e) => (e.rubro ?? null) === rubro);
    const actual = round2(entries.reduce((s, e) => s + (e.labor?.hours ?? 0), 0));
    return {
      projectId: project.id,
      rubro,
      estimated,
      actual,
      over: round2(actual - estimated),
      pct: overPct(estimated, actual),
      flagged: rubro !== null && estimated > 0 && exceeds(estimated, actual, t),
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

  for (const d of dayDeviations(ctx.projects, ctx.assignments, t)) {
    const p = byId.get(d.projectId);
    if (!p || !d.flagged) continue;
    alerts.push(
      withKey(
        {
          ...alertBase(p),
          id: `${p.id}:hours-day:${d.operatorId}:${d.date}:${d.rubro}`,
          kind: "hours",
          level: "warning",
          title: `${name(d.operatorId)} trabajó ${formatNumber(d.over)} h más de lo previsto en ${rubroLabel(d.rubro)}`,
          message: `El ${formatDate(d.date)} se previeron ${formatNumber(d.planned)} h y se cargaron ${formatNumber(d.actual)} h (+${formatNumber(d.over)} h${signedPct(d.pct)}).`,
          records: d.records.map(describe),
        },
        p,
        ctx.today,
      ),
    );
  }

  for (const p of ctx.projects.filter((x) => !x.isClosed && x.status !== "quotation")) {
    for (const r of rubroHours(p, t)) {
      if (!r.flagged || r.rubro === null) continue;
      alerts.push(
        withKey(
          {
            ...alertBase(p),
            id: `${p.id}:hours-rubro:${r.rubro}:${Math.round(r.actual)}`,
            kind: "hours",
            level: (r.pct ?? 0) >= 2 * t.pct ? "critical" : "warning",
            title: `${rubroLabel(r.rubro)}: ${formatNumber(r.over)} h por encima de lo estimado`,
            message: `El presupuesto estimó ${formatNumber(r.estimated)} h y ya se cargaron ${formatNumber(r.actual)} h (+${formatNumber(r.over)} h${signedPct(r.pct)}).`,
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
    const load = dayLoad(ctx.assignments, operatorId, date, ctx.hoursPerDay);
    if (!load.overloaded) continue;
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
          title: `${name(operatorId)} tiene ${formatNumber(load.planned)} h asignadas el ${formatDate(date)}`,
          message: `Su jornada es de ${formatNumber(ctx.hoursPerDay)} h: ${formatNumber(load.overtimeHours)} h serían horas extra.`,
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
          id: `${p.id}:unassigned:${r.rubro}`,
          kind: "unassigned",
          level: r.daysLeft < 0 ? "critical" : "warning",
          title: `${rubroLabel(r.rubro)} sin operarios asignados`,
          message: `El presupuesto pide ${r.workers} ${r.workers === 1 ? "operario" : "operarios"} y hay ${r.assigned} asignado${r.assigned === 1 ? "" : "s"}. ${
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
