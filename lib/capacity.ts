// ─────────────────────────────────────────────────────────────
// Capacidad de operarios y horas extra — funciones puras, sin UI.
//
// Es una ESTIMACIÓN simple, no una agenda: cuenta días hábiles (lun–vie)
// hasta el plazo, la jornada diaria y las horas que el operario ya tiene
// asignadas en otros proyectos activos. Lo que no entra en horario normal
// se calcula como horas extra, con el costo por hora × multiplicador.
//
// Lote 4: la cotización usa workingDaysBetween, splitOvertime y laborAmount
// (por cantidad de operarios, sin nombres). La disponibilidad por operario
// con nombre (hoursAssignedElsewhere, operatorCapacity, planLabor) queda
// para que el jefe de planta asigne personas en el Lote 5.
// ─────────────────────────────────────────────────────────────
import type { Operator, Project } from "@/types";
import { ACTIVE_STATUSES } from "./constants";

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);

function utc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Días hábiles (lun–vie) entre dos fechas ISO, contando ambas puntas. 0 si `end` es anterior a `start`. */
export function workingDaysBetween(startISO: string, endISO: string): number {
  if (!startISO || !endISO || endISO < startISO) return 0;
  const date = utc(startISO);
  const end = utc(endISO).getTime();
  let days = 0;
  while (date.getTime() <= end) {
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

/** Días hábiles para producir: desde el inicio hasta el plazo, descontando los días de instalación. */
export function productionWindowDays(startISO: string, deadlineISO: string, installationDays: number): number {
  return Math.max(0, workingDaysBetween(startISO, deadlineISO) - Math.max(0, Math.ceil(finite(installationDays))));
}

const maxISO = (a: string, b: string) => (a > b ? a : b);
const minISO = (a: string, b: string) => (a < b ? a : b);

/**
 * Horas que el operario ya tiene asignadas en OTROS proyectos activos dentro del período [from, to].
 * Por proyecto: horas presupuestadas para ese operario − horas que ya registró. Lo pendiente se reparte
 * parejo entre los días hábiles que le quedan a ese proyecto (desde hoy hasta su entrega) y se cuenta
 * la parte que cae en el período. Si el proyecto ya está vencido, todo lo pendiente cuenta.
 */
export function hoursAssignedElsewhere(
  operatorId: string,
  projects: Project[],
  period: { from: string; to: string; today: string; excludeProjectId?: string },
): number {
  let total = 0;
  for (const p of projects) {
    if (p.id === period.excludeProjectId || !ACTIVE_STATUSES.includes(p.status)) continue;
    const planned = p.budgetLines
      .filter((l) => l.category === "labor" && l.operatorId === operatorId)
      .reduce((s, l) => s + finite(l.quantity ?? 0), 0);
    if (!(planned > 0)) continue;
    const logged = p.actualEntries
      .filter((e) => e.operatorId === operatorId && e.labor)
      .reduce((s, e) => s + finite(e.labor?.hours ?? 0), 0);
    const pending = Math.max(0, planned - logged);
    if (pending === 0) continue;

    const windowStart = maxISO(p.startDate, period.today);
    const windowDays = workingDaysBetween(windowStart, p.dueDate);
    if (windowDays === 0) {
      total += pending;
      continue;
    }
    const overlap = workingDaysBetween(maxISO(windowStart, period.from), minISO(p.dueDate, period.to));
    total += (pending * overlap) / windowDays;
  }
  return round2(total);
}

/** Horas disponibles = jornada diaria × días hábiles − horas ya asignadas en otros proyectos (nunca negativo). */
export function operatorCapacity(p: { hoursPerDay: number; workingDays: number; assignedHours: number }): number {
  return round2(Math.max(0, finite(p.hoursPerDay) * finite(p.workingDays) - finite(p.assignedHours)));
}

/** Lo que entra en las horas disponibles es horario normal; la diferencia, horas extra. */
export function splitOvertime(neededHours: number, availableHours: number): { normalHours: number; overtimeHours: number } {
  const needed = Math.max(0, finite(neededHours));
  const normalHours = round2(Math.min(needed, Math.max(0, finite(availableHours))));
  return { normalHours, overtimeHours: round2(needed - normalHours) };
}

export interface LaborAmount {
  normalCost: number;
  /** Costo por hora extra = costo por hora × multiplicador. */
  overtimeRate: number;
  overtimeCost: number;
  total: number;
}

/** horas normales × costo + horas extra × (costo × multiplicador). */
export function laborAmount(p: { normalHours: number; overtimeHours: number; hourlyCost: number; multiplier: number }): LaborAmount {
  const rate = Math.max(0, finite(p.hourlyCost));
  const overtimeRate = round2(rate * Math.max(1, finite(p.multiplier)));
  const normalCost = round2(finite(p.normalHours) * rate);
  const overtimeCost = round2(finite(p.overtimeHours) * overtimeRate);
  return { normalCost, overtimeRate, overtimeCost, total: round2(normalCost + overtimeCost) };
}

/** Reparte las horas del rol en partes iguales; el último absorbe el redondeo para que sume exacto. */
export function splitHoursEvenly(hours: number, count: number): number[] {
  if (count <= 0) return [];
  const each = round2(finite(hours) / count);
  const parts = Array.from({ length: count }, () => each);
  parts[count - 1] = round2(finite(hours) - each * (count - 1));
  return parts;
}

// ── Plan de mano de obra del Cotizador ───────────────────────

export interface LaborRequest {
  role: string;
  /** Horas totales del rol (se reparten entre los operarios elegidos). */
  hours: number;
  operatorIds: string[];
}

export interface PlanContext {
  operators: Operator[];
  projects: Project[];
  startDate: string;
  /** Plazo de entrega. Sin plazo no se calcula disponibilidad: todas las horas son normales. */
  deadline?: string | null;
  installationDays: number;
  hoursPerDay: number;
  overtimeMultiplier: number;
  today: string;
  /** Al editar un proyecto existente, sus propias horas no cuentan como "asignadas en otro proyecto". */
  excludeProjectId?: string;
}

export interface OperatorPlan extends LaborAmount {
  operatorId: string;
  name: string;
  hours: number;
  hourlyCost: number;
  /** true = el operario no tiene costo por hora cargado: su costo da 0 hasta que se complete. */
  missingCost: boolean;
  /** null = sin plazo (no se calcula). */
  availableHours: number | null;
  assignedElsewhere: number;
  normalHours: number;
  overtimeHours: number;
}

export interface RolePlan {
  role: string;
  hours: number;
  operators: OperatorPlan[];
  /** Suma de horas disponibles de los operarios elegidos. null = sin plazo. */
  availableHours: number | null;
  overtimeHours: number;
  /** true = las horas del rol no entran en el horario normal de los operarios elegidos. */
  shortage: boolean;
  total: number;
}

export interface LaborPlan {
  roles: RolePlan[];
  /** Días hábiles desde el inicio hasta el plazo (null = sin plazo). */
  workingDays: number | null;
  /** Días hábiles para producir (descontando instalación). null = sin plazo. */
  productionDays: number | null;
}

export function planLabor(requests: LaborRequest[], ctx: PlanContext): LaborPlan {
  const deadline = ctx.deadline || null;
  const workingDays = deadline ? workingDaysBetween(ctx.startDate, deadline) : null;
  const prodDays = deadline ? productionWindowDays(ctx.startDate, deadline, ctx.installationDays) : null;

  const roles = requests.map((r): RolePlan => {
    const chosen = r.operatorIds
      .map((id) => ctx.operators.find((o) => o.id === id))
      .filter((o): o is Operator => !!o);
    const parts = splitHoursEvenly(r.hours, chosen.length);
    const operators = chosen.map((o, i): OperatorPlan => {
      const hours = parts[i];
      const assignedElsewhere = deadline
        ? hoursAssignedElsewhere(o.id, ctx.projects, { from: ctx.startDate, to: deadline, today: ctx.today, excludeProjectId: ctx.excludeProjectId })
        : 0;
      const availableHours =
        prodDays === null ? null : operatorCapacity({ hoursPerDay: ctx.hoursPerDay, workingDays: prodDays, assignedHours: assignedElsewhere });
      const split = availableHours === null ? { normalHours: round2(hours), overtimeHours: 0 } : splitOvertime(hours, availableHours);
      const hourlyCost = Math.max(0, finite(o.hourlyCost));
      return {
        operatorId: o.id,
        name: o.name,
        hours,
        hourlyCost,
        missingCost: !(hourlyCost > 0),
        availableHours,
        assignedElsewhere,
        ...split,
        ...laborAmount({ ...split, hourlyCost, multiplier: ctx.overtimeMultiplier }),
      };
    });
    const overtimeHours = round2(operators.reduce((s, o) => s + o.overtimeHours, 0));
    return {
      role: r.role,
      hours: round2(finite(r.hours)),
      operators,
      availableHours: prodDays === null ? null : round2(operators.reduce((s, o) => s + (o.availableHours ?? 0), 0)),
      overtimeHours,
      shortage: overtimeHours > 0,
      total: round2(operators.reduce((s, o) => s + o.total, 0)),
    };
  });
  return { roles, workingDays, productionDays: prodDays };
}
