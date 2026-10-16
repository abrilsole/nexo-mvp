// Días laborales y capacidad diaria de cada operario (Lote 6 · Fase 3). Funciones puras.
//
// - Cada operario trabaja ciertos días de la semana (sin dato: lunes a viernes).
// - Una excepción por fecha manda sobre eso: "trabaja este sábado (4 h)" o "no viene el viernes".
// - Capacidad de un día = 0 si no trabaja; si trabaja, las horas de la excepción o la jornada de Configuración.
// - Calendario: por operario y día, horas asignadas / capacidad, y un chip por proyecto (con su color) uno al lado del
//   otro. Se marca en rojo si lo asignado pasa la capacidad y en gris si no es día laborable.
import type { DayException, Operator, Project, WorkAssignment } from "@/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];
export const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function utc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function plusDays(iso: string, n: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export const dayOfWeek = (iso: string) => utc(iso).getUTCDay();

/** Lunes a domingo de la semana de `iso`. */
export function fullWeek(iso: string): string[] {
  const dow = dayOfWeek(iso);
  const monday = plusDays(iso, dow === 0 ? -6 : 1 - dow);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => plusDays(monday, i));
}

export const workDaysOf = (o: Pick<Operator, "workDays">) => (o.workDays ? [...o.workDays].sort((a, b) => a - b) : DEFAULT_WORK_DAYS);

/** "lunes a viernes", "lunes, miércoles y sábado", "ningún día". */
export function workDaysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (sorted.length === 0) return "ningún día";
  const key = sorted.join(",");
  if (key === "1,2,3,4,5") return "lunes a viernes";
  if (key === "1,2,3,4,5,6") return "lunes a sábado";
  const names = sorted.map((d) => WEEKDAY_NAMES[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** "sábados", "domingos", "lunes"… */
const plural = (d: number) => (d === 0 || d === 6 ? `${WEEKDAY_NAMES[d]}s` : WEEKDAY_NAMES[d]);

export interface DayCapacity {
  working: boolean;
  /** Horas disponibles ese día (0 si no trabaja). */
  hours: number;
  /** La excepción que decide el día, si hay. */
  exception?: DayException;
  /** Por qué: "lunes a viernes", "excepción: trabaja este sábado", etc. */
  reason: string;
}

export function dayCapacity(
  operator: Pick<Operator, "id" | "workDays">,
  date: string,
  exceptions: DayException[],
  hoursPerDay: number,
): DayCapacity {
  const exception = exceptions.find((x) => x.operatorId === operator.id && x.date === date);
  if (exception) {
    const hours = exception.works ? round2(exception.hours ?? hoursPerDay) : 0;
    const what = exception.works ? `trabaja ${hours} h` : "no trabaja";
    return { working: exception.works, hours, exception, reason: `Excepción: ${what}${exception.note ? ` (${exception.note})` : ""}` };
  }
  const days = workDaysOf(operator);
  const working = days.includes(dayOfWeek(date));
  return {
    working,
    hours: working ? round2(hoursPerDay) : 0,
    reason: working ? `Trabaja ${workDaysLabel(days)}` : `No trabaja los ${plural(dayOfWeek(date))} (trabaja ${workDaysLabel(days)})`,
  };
}

/** Días laborables del operario entre `from` y `to` (inclusive), según sus días y excepciones. Máximo 60. */
export function operatorWorkdays(
  operator: Pick<Operator, "id" | "workDays">,
  exceptions: DayException[],
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 60; d = plusDays(d, 1)) {
    if (dayCapacity(operator, d, exceptions, 1).working) out.push(d);
  }
  return out;
}

export interface CellChip {
  projectId: string;
  hours: number;
  assignmentIds: string[];
}

export interface CalendarCell {
  operatorId: string;
  date: string;
  planned: number;
  capacity: DayCapacity;
  /** Lo asignado pasa la capacidad del día (incluye asignar en un día no laborable). */
  over: boolean;
  overBy: number;
  /** Un chip por proyecto (las asignaciones del mismo proyecto se suman): van uno al lado del otro. */
  chips: CellChip[];
}

export function calendarCell(
  operator: Pick<Operator, "id" | "workDays">,
  date: string,
  assignments: WorkAssignment[],
  exceptions: DayException[],
  hoursPerDay: number,
): CalendarCell {
  const mine = assignments.filter((a) => a.operatorId === operator.id && a.date === date);
  const chips: CellChip[] = [];
  for (const a of mine) {
    const chip = chips.find((c) => c.projectId === a.projectId);
    if (chip) {
      chip.hours = round2(chip.hours + a.plannedHours);
      chip.assignmentIds.push(a.id);
    } else chips.push({ projectId: a.projectId, hours: a.plannedHours, assignmentIds: [a.id] });
  }
  const planned = round2(mine.reduce((s, a) => s + a.plannedHours, 0));
  const capacity = dayCapacity(operator, date, exceptions, hoursPerDay);
  const overBy = round2(Math.max(0, planned - capacity.hours));
  return { operatorId: operator.id, date, planned, capacity, over: overBy > 0, overBy, chips };
}

/** Paleta fija de chips (fondo / borde / texto) con contraste AA. */
export const PROJECT_COLORS = [
  "bg-blue-100 border-blue-300 text-blue-900",
  "bg-emerald-100 border-emerald-300 text-emerald-900",
  "bg-violet-100 border-violet-300 text-violet-900",
  "bg-amber-100 border-amber-300 text-amber-900",
  "bg-pink-100 border-pink-300 text-pink-900",
  "bg-cyan-100 border-cyan-300 text-cyan-900",
  "bg-lime-100 border-lime-300 text-lime-900",
  "bg-orange-100 border-orange-300 text-orange-900",
] as const;

/** Color estable de cada proyecto: por orden de código entre los proyectos (el mismo en toda la grilla). */
export function projectColorIndex(projectId: string, projects: Pick<Project, "id" | "code">[]): number {
  const codes = [...projects].sort((a, b) => a.code.localeCompare(b.code));
  const i = codes.findIndex((p) => p.id === projectId);
  return (i < 0 ? 0 : i) % PROJECT_COLORS.length;
}

export interface ExceptionInput {
  date: string;
  works: boolean;
  hours?: number;
  note?: string;
}

export function exceptionError(x: ExceptionInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return "Elegí la fecha.";
  if (x.works && x.hours !== undefined && !(x.hours > 0 && x.hours <= 24)) return "Las horas van de 0 a 24.";
  return null;
}

export function workDaysError(days: number[]): string | null {
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Día de la semana inválido.";
  return null;
}
