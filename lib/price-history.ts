// ─────────────────────────────────────────────────────────────
// Precios con vigencia — funciones puras (Lote 5A).
// Tarifas por tipo de hora, multiplicador de horas extra, costo por hora de cada operario y
// precio de materiales: cada cambio es un registro nuevo con "vigente desde". El pasado no se
// modifica nunca. Misma regla que private.value_at en la base. Ver docs/HISTORIAL_DE_PRECIOS.md.
// ─────────────────────────────────────────────────────────────
import type { HourRate, LaborValuation, Operator, PriceKind, PriceRecord } from "@/types";
import { createId } from "./activity";

/** subjectId del multiplicador de horas extra (hay uno solo por empresa). */
export const OVERTIME_SUBJECT = "default";

/**
 * Fecha desde la que vale el valor que había antes del primer cambio. Así, cuando algo cambia por primera vez,
 * las fechas anteriores siguen con el valor de siempre.
 */
export const BEFORE_HISTORY = "2000-01-01";

type Dated = Pick<PriceRecord, "id" | "value" | "validFrom" | "createdAt">;

/** Más nuevo primero: mayor "vigente desde"; el mismo día, el último cargado. */
const newestFirst = (a: Dated, b: Dated) =>
  b.validFrom.localeCompare(a.validFrom) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** Registro vigente en una fecha (o null sin historial). Antes del primer registro vale el primero. */
export function recordAt<T extends Dated>(history: T[], date: string): T | null {
  if (history.length === 0) return null;
  const sorted = [...history].sort(newestFirst);
  const current = sorted.find((r) => r.validFrom <= date);
  if (current) return current;
  const earliest = sorted[sorted.length - 1].validFrom;
  return sorted.find((r) => r.validFrom === earliest) ?? null;
}

/** Valor vigente en una fecha (null sin historial). */
export function rateAt(history: Dated[], date: string): number | null {
  return recordAt(history, date)?.value ?? null;
}

export function historyFor(all: PriceRecord[], kind: PriceKind, subjectId: string): PriceRecord[] {
  return all.filter((r) => r.kind === kind && r.subjectId === subjectId);
}

/** Valor vigente; sin historial, el valor cargado de siempre (`fallback`). */
export function valueAt(all: PriceRecord[], kind: PriceKind, subjectId: string, date: string, fallback: number): number {
  return rateAt(historyFor(all, kind, subjectId), date) ?? fallback;
}

export type TimelineStatus = "previous" | "current" | "scheduled";

/** Historial para mostrar: más nuevo primero, marcando el vigente hoy y los programados a futuro. */
export function priceTimeline(history: PriceRecord[], today: string): Array<PriceRecord & { status: TimelineStatus }> {
  const current = recordAt(history, today);
  return [...history].sort(newestFirst).map((r) => ({
    ...r,
    status: r === current ? "current" : r.validFrom > today ? "scheduled" : "previous",
  }));
}

export interface PriceChangeInput {
  kind: PriceKind;
  subjectId: string;
  value: number;
  validFrom: string;
  /** Valor que se usaba hasta ahora (el cargado de siempre, si todavía no hay historial). */
  previousValue: number;
  createdBy: string;
  now: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problema con un cambio de valor, o null si está bien. */
export function priceChangeError(input: Pick<PriceChangeInput, "value" | "validFrom">): string | null {
  if (!(input.value > 0)) return "El valor tiene que ser mayor a cero.";
  if (!ISO_DATE.test(input.validFrom) || Number.isNaN(Date.parse(input.validFrom))) return "Indicá desde qué fecha vale.";
  return null;
}

/**
 * Registros a agregar por un cambio (nunca se modifica uno anterior). Si es el primer cambio de ese valor,
 * también se guarda el anterior "desde siempre", para que las fechas pasadas no cambien.
 * Sin cambio real (mismo valor vigente en esa fecha), no agrega nada.
 */
export function priceChange(all: PriceRecord[], input: PriceChangeInput): PriceRecord[] {
  const error = priceChangeError(input);
  if (error) throw new Error(error);
  const history = historyFor(all, input.kind, input.subjectId);
  if ((rateAt(history, input.validFrom) ?? input.previousValue) === input.value) return [];
  const record = (value: number, validFrom: string, createdBy: string): PriceRecord => ({
    id: createId("ph"),
    kind: input.kind,
    subjectId: input.subjectId,
    value,
    validFrom,
    createdAt: input.now,
    createdBy,
  });
  const out: PriceRecord[] = [];
  if (history.length === 0 && input.previousValue > 0 && input.validFrom > BEFORE_HISTORY) {
    out.push(record(input.previousValue, BEFORE_HISTORY, "Valor anterior"));
  }
  out.push(record(input.value, input.validFrom, input.createdBy));
  return out;
}

/** Tarifas vigentes en una fecha (sin historial, la cargada). */
export function hourRatesAt(rates: HourRate[], all: PriceRecord[], date: string): HourRate[] {
  return rates.map((r) => ({ ...r, hourlyRate: valueAt(all, "hour_rate", r.id, date, r.hourlyRate) }));
}

/** Operarios con el costo por hora vigente en una fecha. */
export function operatorsAt(operators: Operator[], all: PriceRecord[], date: string): Operator[] {
  return operators.map((o) => ({ ...o, hourlyCost: valueAt(all, "operator_cost", o.id, date, o.hourlyCost) }));
}

/**
 * Costo de una hora real de un operario en una fecha (lo mismo que private.labor_cost_at en la base).
 * "operator": su costo por hora vigente ese día · "general": la tarifa de Mano de obra vigente ese día.
 */
export function laborCostAt(input: {
  valuation: LaborValuation;
  operator: Pick<Operator, "id" | "hourlyCost">;
  laborRate: number | undefined;
  history: PriceRecord[];
  date: string;
}): number {
  if (input.valuation === "general") {
    return valueAt(input.history, "hour_rate", "labor", input.date, input.laborRate ?? input.operator.hourlyCost);
  }
  return valueAt(input.history, "operator_cost", input.operator.id, input.date, input.operator.hourlyCost);
}
