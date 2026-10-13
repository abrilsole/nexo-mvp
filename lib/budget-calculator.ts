// ─────────────────────────────────────────────────────────────
// Cotización por rubros — funciones puras, sin UI ni estado (Lote 4).
//
// Cada rubro tiene materiales, operarios × horas por operario y horas
// administrativas / diseño (o solo un importe: Transporte / Fletes e
// Imprevistos). De ahí salen las líneas del costo presupuestado, los días
// de trabajo, las horas extra, el precio sugerido y la rentabilidad.
// Todo es una ESTIMACIÓN con lo que carga el usuario: sin datos ocultos.
// ─────────────────────────────────────────────────────────────
import type { BudgetCategory, HourRate, RubroId } from "@/types";
import type { BudgetLineInput } from "./project-operations";
import { laborAmount, splitOvertime, workingDaysBetween } from "./capacity";
import { rubroDef } from "./rubros";

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const positive = (n: number) => Math.max(0, finite(n));

export interface QuoteMaterial {
  /** Id de catálogo si corresponde (permite reconciliar compras y consumos). */
  materialId?: string;
  name: string;
  unit: string;
  quantity: number;
  /** Para algo que se compra hecho alcanza con cantidad 1 y el costo total acá. */
  unitCost: number;
  /** % extra de desperdicio esperado, se suma a la cantidad presupuestada. */
  wastePct: number;
}

/** Un rubro de la cotización. Es un dato plano: un conjunto de rubros se puede guardar como plantilla. */
export interface QuoteRubro {
  rubro: RubroId;
  materials: QuoteMaterial[];
  /** Cantidad de operarios (sin nombre: el jefe de planta asigna después). */
  workers: number;
  hoursPerWorker: number;
  /** Horas administrativas / diseño del rubro (totales, sin nombre). */
  adminHours: number;
  /** Solo rubros de importe (Transporte / Fletes, Imprevistos). */
  amount: number;
}

export interface QuoteTargets {
  /** Rentabilidad objetivo de materiales: ganancia sobre el precio de venta, en %. */
  materialsTargetPct: number;
  /** Rentabilidad objetivo de mano de obra (incluye las horas administrativas), en %. */
  laborTargetPct: number;
  /** Gasto financiero: % sobre el precio de venta. */
  financialPct: number;
}

export interface QuoteInput extends QuoteTargets {
  rubros: QuoteRubro[];
  /** Jornada diaria por operario, en horas. */
  hoursPerDay: number;
  startDate: string;
  /** Fecha de entrega comprometida (opcional). */
  deadline: string | null;
  rates: HourRate[];
  overtimeMultiplier: number;
}

/** Ajuste por historial: % extra sobre una categoría, con su fundamento (muestra). */
export interface CalcAdjustment {
  category: BudgetCategory;
  pct: number;
  sampleSize: number;
  projectType: string;
}

// ── Cantidades y tarifas ──────────────────────────────────────

export function materialBudgetQuantity(m: Pick<QuoteMaterial, "quantity" | "wastePct">): number {
  return round2(finite(m.quantity) * (1 + positive(m.wastePct) / 100));
}

/** Tarifa vigente del tipo de hora de esa categoría (la primera de la lista). undefined si no hay. */
export function rateFor(rates: HourRate[], category: HourRate["category"]): HourRate | undefined {
  return rates.find((r) => r.category === category);
}

// ── Días de trabajo y horas extra ─────────────────────────────

export interface WorkSchedule {
  /** Días de trabajo estimados (horas por operario / jornada, rubro detrás de rubro), sin redondear. */
  neededDays: number;
  /** Lo mismo, redondeado hacia arriba a días enteros. */
  workDays: number;
  /** Días hábiles desde el inicio hasta la entrega comprometida (null = sin fecha). */
  availableDays: number | null;
  /** null = sin fecha de entrega. */
  fits: boolean | null;
  /** Parte de las horas que entra en horario normal (1 = todas). Lo demás son horas extra. */
  normalShare: number;
}

/**
 * Supuesto conservador (a confirmar): los rubros se hacen uno detrás de otro. Cada rubro suma
 * horas por operario / jornada; sus operarios trabajan en paralelo dentro del rubro.
 * Si con la fecha de entrega no alcanzan los días, la misma proporción de horas de cada rubro
 * pasa a horas extra (horas disponibles / horas necesarias).
 */
export function workSchedule(rubros: QuoteRubro[], hoursPerDay: number, startDate: string, deadline: string | null): WorkSchedule {
  const hpd = positive(hoursPerDay);
  const neededDays = hpd > 0 ? rubros.filter((r) => r.workers > 0).reduce((s, r) => s + positive(r.hoursPerWorker) / hpd, 0) : 0;
  const availableDays = deadline ? workingDaysBetween(startDate, deadline) : null;
  const fits = availableDays === null ? null : neededDays <= availableDays + 1e-9;
  const normalShare = availableDays === null || neededDays === 0 ? 1 : Math.min(1, availableDays / neededDays);
  return { neededDays: round2(neededDays), workDays: Math.ceil(neededDays - 1e-9), availableDays, fits, normalShare };
}

export interface RubroLabor {
  workers: number;
  hoursPerWorker: number;
  normalHoursPerWorker: number;
  overtimeHoursPerWorker: number;
  normalHours: number;
  overtimeHours: number;
  rate: number;
  overtimeRate: number;
  normalCost: number;
  overtimeCost: number;
  adminHours: number;
  adminRate: number;
  adminCost: number;
  /** Mano de obra + horas administrativas del rubro. */
  total: number;
}

/** Horas normales × tarifa + horas extra × tarifa × multiplicador + horas administrativas × tarifa administrativa. */
export function rubroLabor(
  r: Pick<QuoteRubro, "workers" | "hoursPerWorker" | "adminHours">,
  p: { normalShare: number; laborRate: number; adminRate: number; overtimeMultiplier: number },
): RubroLabor {
  const workers = Math.max(0, Math.round(finite(r.workers)));
  const hoursPerWorker = workers > 0 ? positive(r.hoursPerWorker) : 0;
  const perWorker = splitOvertime(hoursPerWorker, hoursPerWorker * Math.min(1, Math.max(0, p.normalShare)));
  const normalHours = round2(perWorker.normalHours * workers);
  const overtimeHours = round2(perWorker.overtimeHours * workers);
  const labor = laborAmount({ normalHours, overtimeHours, hourlyCost: p.laborRate, multiplier: p.overtimeMultiplier });
  const adminHours = positive(r.adminHours);
  const adminRate = positive(p.adminRate);
  const adminCost = round2(adminHours * adminRate);
  return {
    workers,
    hoursPerWorker,
    normalHoursPerWorker: perWorker.normalHours,
    overtimeHoursPerWorker: perWorker.overtimeHours,
    normalHours,
    overtimeHours,
    rate: positive(p.laborRate),
    overtimeRate: labor.overtimeRate,
    normalCost: labor.normalCost,
    overtimeCost: labor.overtimeCost,
    adminHours,
    adminRate,
    adminCost,
    total: round2(labor.total + adminCost),
  };
}

// ── Líneas del costo presupuestado ────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const num = (n: number) => String(round2(n)).replace(".", ",");

/** Líneas de un rubro, cada una trazable a lo cargado. Las horas guardan el tipo de hora y su tarifa vigente. */
export function rubroLines(r: QuoteRubro, labor: RubroLabor | null, rates: { labor?: HourRate; admin?: HourRate }, overtimeMultiplier: number): BudgetLineInput[] {
  const def = rubroDef(r.rubro);
  if (def.kind === "amount") {
    const amount = positive(r.amount);
    return amount > 0 && def.amountCategory
      ? [{ category: def.amountCategory, rubro: r.rubro, description: def.label, quantity: null, unit: "global", unitCost: amount }]
      : [];
  }
  const lines: BudgetLineInput[] = [];
  for (const m of r.materials) {
    if (!m.name.trim() || !(m.quantity > 0)) continue;
    lines.push({
      category: "materials",
      rubro: r.rubro,
      description: m.name.trim(),
      materialId: m.materialId,
      quantity: materialBudgetQuantity(m),
      unit: m.unit.trim() || "u",
      unitCost: positive(m.unitCost),
      notes: m.wastePct > 0 ? `Incluye ${num(m.wastePct)}% de desperdicio esperado sobre ${num(m.quantity)} ${m.unit}.` : undefined,
    });
  }
  if (labor && labor.normalHours > 0) {
    lines.push({
      category: "labor",
      rubro: r.rubro,
      description: `${def.label}: mano de obra (${plural(labor.workers, "operario", "operarios")} × ${num(labor.normalHoursPerWorker)} h)`,
      quantity: labor.normalHours,
      unit: "h",
      unitCost: labor.rate,
      hourRateId: rates.labor?.id,
      hourType: "normal",
      notes: rates.labor ? `Tarifa "${rates.labor.name}" vigente al cotizar.` : undefined,
    });
  }
  if (labor && labor.overtimeHours > 0) {
    const multiplier = Math.max(1, finite(overtimeMultiplier));
    lines.push({
      category: "labor",
      rubro: r.rubro,
      description: `${def.label}: horas extra (${plural(labor.workers, "operario", "operarios")} × ${num(labor.overtimeHoursPerWorker)} h, ×${num(multiplier)})`,
      quantity: labor.overtimeHours,
      unit: "h",
      unitCost: labor.overtimeRate,
      hourRateId: rates.labor?.id,
      hourType: "overtime",
      overtimeMultiplier: multiplier,
      notes: `Tarifa ${num(labor.rate)} × ${num(multiplier)}.`,
    });
  }
  if (labor && labor.adminHours > 0) {
    lines.push({
      category: "admin",
      rubro: r.rubro,
      description: `${def.label}: horas administrativas / diseño`,
      quantity: labor.adminHours,
      unit: "h",
      unitCost: labor.adminRate,
      hourRateId: rates.admin?.id,
      hourType: "normal",
      notes: rates.admin ? `Tarifa "${rates.admin.name}" vigente al cotizar.` : undefined,
    });
  }
  return lines;
}

/** Ajustes por historial: línea explícita dentro de su categoría, sin rubro. */
export function adjustmentLines(lines: BudgetLineInput[], adjustments: CalcAdjustment[]): BudgetLineInput[] {
  const out: BudgetLineInput[] = [];
  for (const a of adjustments) {
    const base = totalOfLines(lines.filter((l) => l.category === a.category));
    const amount = round2((base * a.pct) / 100);
    if (amount <= 0) continue;
    out.push({
      category: a.category,
      description: `Ajuste por historial (+${round2(a.pct)}%)`,
      quantity: null,
      unit: "global",
      unitCost: amount,
      notes: `Proyectos "${a.projectType}" finalizados (${a.sampleSize}) cerraron en promedio ${round2(a.pct)}% sobre lo presupuestado en esta categoría.`,
    });
  }
  return out;
}

/** Gasto financiero: % sobre el precio de venta. Es un costo, no un rubro. Sin precio todavía no hay línea. */
export function financialLine(financialPct: number, salesPrice: number): BudgetLineInput | null {
  const amount = round2((positive(salesPrice) * positive(financialPct)) / 100);
  if (!(amount > 0)) return null;
  return {
    category: "financial",
    description: `Gasto financiero (${num(financialPct)}% del precio de venta)`,
    quantity: null,
    unit: "global",
    unitCost: amount,
  };
}

export function totalOfLines(lines: BudgetLineInput[]): number {
  return round2(lines.reduce((s, l) => s + (l.quantity === null ? l.unitCost : l.quantity * l.unitCost), 0));
}

// ── Precio sugerido y rentabilidad ────────────────────────────

/** Costos agrupados como los usa la fórmula del precio (sin el gasto financiero, que depende del precio). */
export interface CostGroups {
  materials: number;
  /** Mano de obra + horas administrativas / diseño. */
  labor: number;
  transport: number;
  contingency: number;
}

export function costGroups(lines: BudgetLineInput[]): CostGroups {
  const of = (...cats: BudgetCategory[]) => totalOfLines(lines.filter((l) => cats.includes(l.category)));
  return { materials: of("materials"), labor: of("labor", "admin"), transport: of("transport"), contingency: of("contingency") };
}

const costWithoutFinancial = (c: CostGroups) => round2(c.materials + c.labor + c.transport + c.contingency);
const validPct = (n: number) => Number.isFinite(n) && n >= 0 && n < 100;

function marginAt(salesPrice: number, cost: number): number | null {
  if (!(salesPrice > 0)) return null;
  return ((salesPrice - cost) / salesPrice) * 100;
}

export interface PriceAnalysis {
  price: number;
  financialCost: number;
  /** Costo total con el gasto financiero de ese precio. */
  totalCost: number;
  /** Rentabilidad total: (precio − costo total) / precio. */
  totalMargin: number | null;
}

/** Rentabilidad de un precio cualquiera (por ejemplo, el que se escribe a mano). */
export function analyzePrice(price: number, costs: CostGroups, financialPct: number): PriceAnalysis {
  const financialCost = round2((positive(price) * positive(financialPct)) / 100);
  const totalCost = round2(costWithoutFinancial(costs) + financialCost);
  return { price, financialCost, totalCost, totalMargin: marginAt(price, totalCost) };
}

export interface SuggestedPrice extends PriceAnalysis {
  /** Parte del precio (antes del gasto financiero) que corresponde a materiales: costo / (1 − objetivo). */
  materialsPrice: number;
  laborPrice: number;
  /** Rentabilidad resultante de cada parte (null si esa parte no tiene costo). */
  materialsMargin: number | null;
  laborMargin: number | null;
}

/**
 * Precio sugerido = ( Materiales / (1 − rent. materiales) + Mano de obra y administración / (1 − rent. mano de obra)
 *                     + Transporte + Imprevistos ) / (1 − % gasto financiero)
 * Se redondea hacia arriba al peso. null si falta costo o algún porcentaje no es válido (≥ 100%).
 */
export function suggestedPrice(costs: CostGroups, t: QuoteTargets): SuggestedPrice | null {
  if (!(costWithoutFinancial(costs) > 0) || !validPct(t.materialsTargetPct) || !validPct(t.laborTargetPct) || !validPct(t.financialPct)) return null;
  const materialsPrice = round2(costs.materials / (1 - t.materialsTargetPct / 100));
  const laborPrice = round2(costs.labor / (1 - t.laborTargetPct / 100));
  const beforeFinancial = materialsPrice + laborPrice + costs.transport + costs.contingency;
  const price = Math.ceil(beforeFinancial / (1 - t.financialPct / 100) - 1e-6);
  return {
    ...analyzePrice(price, costs, t.financialPct),
    materialsPrice,
    laborPrice,
    materialsMargin: costs.materials > 0 ? marginAt(materialsPrice, costs.materials) : null,
    laborMargin: costs.labor > 0 ? marginAt(laborPrice, costs.labor) : null,
  };
}

// ── Sensibilidad al atraso ────────────────────────────────────

/** Costo promedio de un día de trabajo: mano de obra en horario normal / días de trabajo estimados. */
export function averageDailyLaborCost(labor: RubroLabor[], neededDays: number): number {
  if (!(neededDays > 0)) return 0;
  return round2(labor.reduce((s, l) => s + l.normalCost, 0) / neededDays);
}

/** El gráfico “¿Qué pasa si el proyecto se alarga?” solo tiene sentido con precio de venta, costo y más de un día de trabajo. */
export function showDelayChart(p: { salesPrice: number; workingDays: number; dailyCost: number; cost: number }): boolean {
  return p.salesPrice > 0 && p.workingDays > 1 && p.dailyCost > 0 && p.cost > 0;
}

export interface DelayPoint {
  extraDays: number;
  cost: number;
  margin: number | null;
}

export interface DelayAnalysis {
  dailyCost: number;
  points: DelayPoint[];
  /** Días de atraso que se pueden absorber sin bajar de la rentabilidad objetivo (0 = cualquier atraso ya la baja). null si no hay datos. */
  extraDaysBeforeTarget: number | null;
  /** Días de atraso hasta rentabilidad 0 (ganancia nula). null si faltan datos. */
  extraDaysToBreakEven: number | null;
  /** true si ya en fecha la rentabilidad queda por debajo del objetivo. */
  belowTargetAtBase: boolean;
}

/**
 * ¿Cuánta rentabilidad se pierde por cada día extra?
 * Supuesto explícito: cada día de atraso cuesta lo mismo que un día promedio de trabajo.
 */
export function delayAnalysis(params: { baseCost: number; salesPrice: number; dailyCost: number; targetMarginPct: number; maxExtraDays?: number }): DelayAnalysis {
  const { baseCost, salesPrice, dailyCost, targetMarginPct } = params;
  const max = params.maxExtraDays ?? 15;
  const points: DelayPoint[] = [];
  for (let d = 0; d <= max; d += 1) {
    const cost = round2(baseCost + d * dailyCost);
    const margin = marginAt(salesPrice, cost);
    points.push({ extraDays: d, cost, margin });
    // No tiene sentido seguir graficando cuando ya se perdió bastante más que la ganancia.
    if (margin !== null && margin < -10) break;
  }
  const baseMargin = marginAt(salesPrice, baseCost);
  if (baseMargin === null || !(dailyCost > 0)) {
    return { dailyCost, points, extraDaysBeforeTarget: null, extraDaysToBreakEven: null, belowTargetAtBase: false };
  }
  const belowTargetAtBase = baseMargin < targetMarginPct - 1e-9;
  const allowedCostForTarget = salesPrice * (1 - targetMarginPct / 100);
  const slackDays = Math.floor((allowedCostForTarget - baseCost + 1e-6) / dailyCost);
  return {
    dailyCost,
    points,
    extraDaysBeforeTarget: belowTargetAtBase ? 0 : Math.max(0, slackDays),
    extraDaysToBreakEven: Math.max(0, Math.floor((salesPrice - baseCost) / dailyCost)),
    belowTargetAtBase,
  };
}

/** Suma `days` días laborales (lun–vie) a una fecha ISO yyyy-mm-dd. */
export function addWorkingDays(startISO: string, days: number): string {
  const [y, m, d] = startISO.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}
