import { LOCALE, CURRENCY } from "./constants";

const currencyFmt = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** $ 12.000.000 */
export function formatCurrency(value: number): string {
  // Intl es-AR produce "$ 12.000.000" (con espacio no separable). Normalizamos el espacio.
  return currencyFmt.format(Math.round(value)).replace(/ /g, " ");
}

/** Monto o "—" cuando no se puede calcular (por ejemplo, ganancia sin precio de venta). */
export function formatCurrencyOrDash(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : formatCurrency(value);
}

/** +$ 800.000 / −$ 50.000 */
export function formatSignedCurrency(value: number): string {
  if (Math.round(value) === 0) return formatCurrency(0);
  const sign = value > 0 ? "+" : "−";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

/** $ 7,2 M / $ 800 k — para storytelling compacto. */
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    const n = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(abs / 1_000_000);
    return `${sign}$ ${n} M`;
  }
  if (abs >= 1_000) {
    const n = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(abs / 1_000);
    return `${sign}$ ${n} k`;
  }
  return `${sign}$ ${Math.round(abs)}`;
}

export function formatSignedCompactCurrency(value: number): string {
  if (Math.round(value) === 0) return "$ 0";
  return `${value > 0 ? "+" : "−"}${formatCompactCurrency(Math.abs(value))}`;
}

export function formatNumber(value: number, maxDecimals = 2): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxDecimals }).format(value);
}

/** 31,3 % */
export function formatPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)}%`;
}

export function formatSignedPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const r = Number(value.toFixed(decimals));
  if (r === 0) return formatPercent(0, decimals);
  return `${r > 0 ? "+" : "−"}${formatPercent(Math.abs(r), decimals)}`;
}

/**
 * Diferencia de margen en "puntos de rentabilidad" (nunca "%" ni "pp").
 *   formatMarginPoints(9.2)                 → "9,2 puntos de rentabilidad"
 *   formatMarginPoints(-9.2, { signed: true }) → "−9,2 puntos de rentabilidad"
 *   formatMarginPoints(-9.2, { signed: true, short: true }) → "−9,2 puntos"
 */
export function formatMarginPoints(
  value: number | null,
  { signed = false, short = false, decimals = 1 }: { signed?: boolean; short?: boolean; decimals?: number } = {},
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const r = Number(value.toFixed(decimals));
  const n = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(r));
  const word = Math.abs(r) === 1 ? "punto" : "puntos";
  const unit = short ? word : `${word} de rentabilidad`;
  if (r === 0) return `0 ${unit}`;
  const sign = signed ? (r > 0 ? "+" : "−") : r < 0 ? "−" : "";
  return `${sign}${n} ${unit}`;
}

/** "1 día" / "3 días". */
export function formatDays(days: number): string {
  return `${days} ${Math.abs(days) === 1 ? "día" : "días"}`;
}

/** "1 día hábil" / "12 días hábiles" (lunes a viernes). */
export function formatWorkingDays(days: number): string {
  return `${days} ${Math.abs(days) === 1 ? "día hábil" : "días hábiles"}`;
}

/** dd/mm/yyyy — acepta "yyyy-mm-dd" o ISO datetime. */
export function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const d = parseDate(value);
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(value)} ${hh}:${mi}`;
}

/** Interpreta "yyyy-mm-dd" como fecha local (no UTC) para evitar corrimientos de día. */
export function parseDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Días enteros entre dos fechas (b − a). */
export function daysBetween(a: string | Date, b: string | Date): number {
  const da = typeof a === "string" ? parseDate(a) : a;
  const db = typeof b === "string" ? parseDate(b) : b;
  if (!da || !db) return 0;
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86_400_000);
}

/** "placa" → "placas" para cantidades ≠ 1. Pluralización simple para unidades comunes. */
export function pluralizeUnit(unit: string, qty: number): string {
  if (Math.abs(qty) === 1) return unit;
  if (["m", "u", "kg", "h", "l", "m2", "m²"].includes(unit)) return unit;
  if (unit.endsWith("s")) return unit;
  if (/[aeiou]$/i.test(unit)) return `${unit}s`;
  return `${unit}es`;
}

export function formatQty(qty: number, unit: string): string {
  return `${formatNumber(qty)} ${pluralizeUnit(unit, qty)}`;
}
