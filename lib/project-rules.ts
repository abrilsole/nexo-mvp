// ─────────────────────────────────────────────────────────────
// Reglas de negocio de proyecto — funciones puras.
//   · estados: se avanza de a uno; sólo Gestión corrige hacia atrás, con confirmación;
//   · ejecución: Cotización y Aprobado no admiten consumo, desperdicio, horas ni costos;
//   · plazo: tiempo transcurrido (NO es avance físico);
//   · horas: validaciones por operario y fecha.
// ─────────────────────────────────────────────────────────────
import type { ActualEntry, AppRole, Project, ProjectStatus } from "@/types";
import { STATUS_LABELS, STATUS_ORDER } from "./constants";
import { daysBetween, formatNumber } from "./formatting";

export class RuleError extends Error {}

/** Etapas en las que se ejecuta el trabajo (consumo, horas, costos). */
export const EXECUTION_STATUSES: ProjectStatus[] = ["approved", "purchasing", "production", "installation"];

/** Etapas con bitácora propia. */
export const STAGE_STATUSES = ["purchasing", "production", "installation"] as const;

/** Etapas donde el taller trabaja (producción e instalación). Compras es de Gestión. */
export const SHOP_FLOOR_STATUSES: ProjectStatus[] = ["approved", "purchasing", "production", "installation"];

export function isManager(role: AppRole): boolean {
  return role === "owner" || role === "member";
}

/** Compran y mueven stock: Administrativo y Compras (Lote 5C). */
export function isBuyer(role: AppRole): boolean {
  return isManager(role) || role === "compras";
}

export function canExecute(status: ProjectStatus): boolean {
  return EXECUTION_STATUSES.includes(status);
}

/** Lanza si el proyecto todavía no está en ejecución. */
export function assertExecutable(project: Pick<Project, "status" | "isClosed">, what: string) {
  if (project.isClosed) throw new RuleError("El proyecto está cerrado: no admite nuevos registros.");
  if (!canExecute(project.status)) {
    throw new RuleError(
      `No se puede registrar ${what} en un proyecto en ${STATUS_LABELS[project.status]}. Aprobá el proyecto para empezar a ejecutar.`,
    );
  }
}

// ── Estados ───────────────────────────────────────────────────

/** Estados a los que se puede ir desde `from`: el siguiente (avanzar) o cualquiera anterior (corregir). */
export function nextStatus(from: ProjectStatus): ProjectStatus | null {
  if (from === "approved") return "production";
  const i = STATUS_ORDER.indexOf(from);
  const next = STATUS_ORDER[i + 1];
  return next && next !== "completed" ? next : null;
}

export function previousStatuses(from: ProjectStatus): ProjectStatus[] {
  const i = STATUS_ORDER.indexOf(from);
  return STATUS_ORDER.slice(0, Math.max(0, i)).filter((s) => s !== "completed");
}

export type TransitionKind = "forward" | "backward";

export function transitionKind(from: ProjectStatus, to: ProjectStatus): TransitionKind | null {
  if (to === "completed" || to === from) return null;
  if (nextStatus(from) === to || (from === "approved" && to === "purchasing")) return "forward";
  if (previousStatuses(from).includes(to)) return "backward";
  return null;
}

export function assertTransition(
  project: Pick<Project, "status" | "isClosed">,
  to: ProjectStatus,
  opts: { role: AppRole; confirmBack?: boolean },
): TransitionKind {
  if (project.isClosed) throw new RuleError("El proyecto está cerrado.");
  if (to === "completed") throw new RuleError("Para finalizar usá “Cerrar proyecto”.");
  if (!isManager(opts.role)) throw new RuleError("Solo un usuario Administrativo puede cambiar la etapa del proyecto.");
  const kind = transitionKind(project.status, to);
  if (!kind) {
    const next = nextStatus(project.status);
    throw new RuleError(
      next
        ? `Desde ${STATUS_LABELS[project.status]} solo se puede pasar a ${STATUS_LABELS[next]} (de a una etapa).`
        : `No se puede pasar de ${STATUS_LABELS[project.status]} a ${STATUS_LABELS[to]}.`,
    );
  }
  if (kind === "backward" && !opts.confirmBack) {
    throw new RuleError(`Volver a ${STATUS_LABELS[to]} es una corrección: confirmala para continuar.`);
  }
  return kind;
}

// ── Plazo (tiempo transcurrido, no avance físico) ─────────────

export interface Schedule {
  startDate: string;
  dueDate: string;
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  /** % del plazo consumido (0–100). Es tiempo, no avance de obra. */
  elapsedPct: number;
  overdue: boolean;
  notStarted: boolean;
}

export function projectSchedule(project: Pick<Project, "startDate" | "dueDate">, today: string): Schedule {
  const totalDays = Math.max(1, daysBetween(project.startDate, project.dueDate));
  const elapsedDays = daysBetween(project.startDate, today);
  const remainingDays = daysBetween(today, project.dueDate);
  const pct = (Math.max(0, elapsedDays) / totalDays) * 100;
  return {
    startDate: project.startDate,
    dueDate: project.dueDate,
    totalDays,
    elapsedDays: Math.max(0, elapsedDays),
    remainingDays,
    elapsedPct: Math.round(Math.min(100, pct)),
    overdue: remainingDays < 0,
    notStarted: elapsedDays < 0,
  };
}

// ── Horas ─────────────────────────────────────────────────────

/** Por encima se pide revisar (si no se indica la jornada); por encima del tope diario se bloquea. */
export const HOURS_WARN_PER_DAY = 16;
export const HOURS_MAX_PER_DAY = 24;

export interface HoursCheck {
  level: "ok" | "warn" | "block";
  /** Horas del día del operario, incluyendo las que se están cargando. */
  dayTotal: number;
  message?: string;
}

export function checkHours(
  entries: Pick<ActualEntry, "type" | "date" | "operatorId" | "labor">[],
  operatorId: string,
  date: string,
  hours: number,
  today: string,
  /** Por encima se avisa (no se bloquea): la jornada de Configuración (Lote 5B). */
  warnAbove: number = HOURS_WARN_PER_DAY,
): HoursCheck {
  if (!Number.isFinite(hours) || !(hours > 0)) return { level: "block", dayTotal: 0, message: "Las horas tienen que ser más que 0." };
  if (date > today) return { level: "block", dayTotal: hours, message: "No se pueden cargar horas de una fecha futura." };
  const prior = entries
    .filter((e) => e.type === "labor" && e.operatorId === operatorId && e.date === date)
    .reduce((s, e) => s + (e.labor?.hours ?? 0), 0);
  const dayTotal = Math.round((prior + hours) * 100) / 100;
  if (dayTotal > HOURS_MAX_PER_DAY) {
    return {
      level: "block",
      dayTotal,
      message: `Ese día ya hay ${formatNumber(prior)} h cargadas: con estas serían ${formatNumber(dayTotal)} h y un día tiene ${HOURS_MAX_PER_DAY}. Corregí las horas.`,
    };
  }
  if (dayTotal > warnAbove) {
    return {
      level: "warn",
      dayTotal,
      message: `Ese día quedarían ${formatNumber(dayTotal)} h cargadas, más que la jornada de ${formatNumber(warnAbove)} h. Revisá que sea correcto.`,
    };
  }
  return { level: "ok", dayTotal };
}
