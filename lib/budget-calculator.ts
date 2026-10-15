// ─────────────────────────────────────────────────────────────
// Cotización por rubros — funciones puras, sin UI ni estado (Lote 4).
//
// Cada rubro tiene materiales, operarios × horas por operario, horas de
// diseño y horas de administración (o solo un importe: Transporte / Fletes e
// Imprevistos). De ahí salen las líneas del costo presupuestado, los días
// de trabajo, las horas extra, el precio sugerido y la rentabilidad.
// Todo es una ESTIMACIÓN con lo que carga el usuario: sin datos ocultos.
// ─────────────────────────────────────────────────────────────
import type { BudgetCategory, HourCategory, HourRate, RubroId } from "@/types";
import type { BudgetLineInput } from "./project-operations";
import { laborAmount, splitOvertime } from "./capacity";
import { RUBROS, rubroDef } from "./rubros";
import { CATEGORY_LABELS } from "./constants";

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
  /** Horas de diseño del rubro (totales, sin nombre). */
  designHours: number;
  /** Horas de administración del rubro (totales, sin nombre). */
  adminHours: number;
  /** Solo rubros de importe (Transporte / Fletes, Imprevistos). */
  amount: number;
}

export interface QuoteTargets {
  /** Rentabilidad objetivo de materiales: ganancia sobre el precio de venta, en %. */
  materialsTargetPct: number;
  /** Rentabilidad objetivo de mano de obra (incluye diseño y administración: a confirmar), en %. */
  laborTargetPct: number;
  /** Gasto financiero: % sobre el precio de venta. */
  financialPct: number;
}

export interface QuoteInput extends QuoteTargets {
  rubros: QuoteRubro[];
  /** Jornada diaria por operario, en horas. */
  hoursPerDay: number;
  /** Plazo en días hábiles (opcional). Sin plazo no hay horas extra. */
  deadlineDays: number | null;
  rates: HourRate[];
  overtimeMultiplier: number;
}

/** Margen de seguridad: % extra sobre una categoría (editable), con su fundamento en proyectos anteriores. */
export interface CalcAdjustment {
  category: BudgetCategory;
  /** % aplicado (lo puede editar el usuario). */
  pct: number;
  /** Desvío promedio de los proyectos comparables, en %. */
  referencePct: number;
  sampleSize: number;
  projectType: string;
}

// ── Cantidades y tarifas ──────────────────────────────────────

export function materialBudgetQuantity(m: Pick<QuoteMaterial, "quantity" | "wastePct">): number {
  return round2(finite(m.quantity) * (1 + positive(m.wastePct) / 100));
}

/** Tarifa vigente de cada categoría de horas (el primer tipo de hora de esa categoría en la lista). */
export function ratesByCategory(rates: HourRate[]): RatesByCategory {
  const out: RatesByCategory = {};
  for (const r of rates) out[r.category] ??= r;
  return out;
}

// ── Días de trabajo y horas extra ─────────────────────────────

export interface WorkSchedule {
  /** Días de trabajo estimados (horas por operario / jornada, rubro detrás de rubro), sin redondear. */
  neededDays: number;
  /** Lo mismo, redondeado hacia arriba a días enteros. */
  workDays: number;
  /** Plazo en días hábiles (null = sin plazo). */
  availableDays: number | null;
  /** null = sin plazo. */
  fits: boolean | null;
  /** Parte de las horas que entra en horario normal (1 = todas). Lo demás son horas extra. */
  normalShare: number;
}

/**
 * Supuesto conservador (a confirmar): los rubros se hacen uno detrás de otro. Cada rubro suma
 * horas por operario / jornada; sus operarios trabajan en paralelo dentro del rubro.
 * Si con el plazo no alcanzan los días, la misma proporción de horas de cada rubro
 * pasa a horas extra (horas disponibles / horas necesarias).
 */
export function workSchedule(rubros: QuoteRubro[], hoursPerDay: number, deadlineDays: number | null): WorkSchedule {
  const hpd = positive(hoursPerDay);
  const neededDays = hpd > 0 ? rubros.filter((r) => r.workers > 0).reduce((s, r) => s + positive(r.hoursPerWorker) / hpd, 0) : 0;
  const availableDays = deadlineDays !== null && deadlineDays > 0 ? Math.floor(deadlineDays) : null;
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
  /** Horas de diseño y de administración: sin horas extra (no dependen de los operarios). */
  design: HourCharge;
  admin: HourCharge;
  /** Mano de obra + diseño + administración del rubro. */
  total: number;
}

/** Horas totales × tarifa de su tipo de hora. */
export interface HourCharge {
  hours: number;
  rate: number;
  cost: number;
}

const hourCharge = (hours: number, rate: number): HourCharge => {
  const h = positive(hours);
  const r = positive(rate);
  return { hours: h, rate: r, cost: round2(h * r) };
};

/** Horas normales × tarifa + horas extra × tarifa × multiplicador + diseño × su tarifa + administración × su tarifa. */
export function rubroLabor(
  r: Pick<QuoteRubro, "workers" | "hoursPerWorker" | "designHours" | "adminHours">,
  p: { normalShare: number; laborRate: number; designRate: number; adminRate: number; overtimeMultiplier: number },
): RubroLabor {
  const workers = Math.max(0, Math.round(finite(r.workers)));
  const hoursPerWorker = workers > 0 ? positive(r.hoursPerWorker) : 0;
  const perWorker = splitOvertime(hoursPerWorker, hoursPerWorker * Math.min(1, Math.max(0, p.normalShare)));
  const normalHours = round2(perWorker.normalHours * workers);
  const overtimeHours = round2(perWorker.overtimeHours * workers);
  const labor = laborAmount({ normalHours, overtimeHours, hourlyCost: p.laborRate, multiplier: p.overtimeMultiplier });
  const design = hourCharge(r.designHours, p.designRate);
  const admin = hourCharge(r.adminHours, p.adminRate);
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
    design,
    admin,
    total: round2(labor.total + design.cost + admin.cost),
  };
}

// ── Líneas del costo presupuestado ────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const num = (n: number) => String(round2(n)).replace(".", ",");

/** Líneas de un rubro, cada una trazable a lo cargado. Las horas guardan el tipo de hora y su tarifa vigente. */
/** Tarifa vigente de cada categoría de horas (undefined = no hay tipo de hora de esa categoría). */
export type RatesByCategory = Partial<Record<HourCategory, HourRate>>;

const rateNote = (rate: HourRate | undefined) => (rate ? `Tarifa "${rate.name}" vigente al cotizar.` : undefined);

/** Lo que se congela en las líneas de horas: tarifas, multiplicador de horas extra y jornada (Configuración). */
export interface LineAssumptions {
  rates: RatesByCategory;
  overtimeMultiplier: number;
  hoursPerDay: number;
}

export function rubroLines(r: QuoteRubro, labor: RubroLabor | null, { rates, overtimeMultiplier, hoursPerDay }: LineAssumptions): BudgetLineInput[] {
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
      hoursPerDay,
      notes: rateNote(rates.labor),
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
      hoursPerDay,
      notes: `Tarifa ${num(labor.rate)} × ${num(multiplier)}.`,
    });
  }
  const flat: Array<[Extract<HourCategory, "design" | "admin">, HourCharge | undefined, string]> = [
    ["design", labor?.design, "horas de diseño"],
    ["admin", labor?.admin, "horas de administración"],
  ];
  for (const [category, charge, what] of flat) {
    if (!charge || !(charge.hours > 0)) continue;
    lines.push({
      category,
      rubro: r.rubro,
      description: `${def.label}: ${what}`,
      quantity: charge.hours,
      unit: "h",
      unitCost: charge.rate,
      hourRateId: rates[category]?.id,
      hourType: "normal",
      notes: rateNote(rates[category]),
    });
  }
  return lines;
}

/** Márgenes de seguridad: línea explícita y trazable dentro de su categoría, sin rubro. */
export function adjustmentLines(lines: BudgetLineInput[], adjustments: CalcAdjustment[]): BudgetLineInput[] {
  const out: BudgetLineInput[] = [];
  for (const a of adjustments) {
    const base = totalOfLines(lines.filter((l) => l.category === a.category));
    const amount = round2((base * a.pct) / 100);
    if (amount <= 0) continue;
    out.push({
      category: a.category,
      description: `Margen de seguridad ${CATEGORY_LABELS[a.category].toLowerCase()} (+${num(a.pct)}%)`,
      quantity: null,
      unit: "global",
      unitCost: amount,
      notes: `+${num(a.pct)}% sobre ${num(base)}. Referencia: ${a.sampleSize} proyectos "${a.projectType}" finalizados costaron en promedio ${num(a.referencePct)}% más de lo presupuestado en esta categoría.`,
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

// ── Resumen por rubro (paso "Revisar y crear") ───────────────

export interface RubroTableRow {
  /** Rubro; undefined = ajustes por historial (no tienen rubro). */
  rubro?: RubroId;
  materials: number;
  labor: number;
  design: number;
  admin: number;
  /** Transporte / Fletes e Imprevistos: solo un importe. */
  amount: number;
  total: number;
}

export interface RubroTable {
  rows: RubroTableRow[];
  financial: number;
  /** Igual al costo presupuestado (totalOfLines de las mismas líneas). */
  total: number;
}

/**
 * Una fila por rubro con importe (en el orden del catálogo) y, al final, los ajustes por historial.
 * El gasto financiero va aparte. Cada celda es la suma de líneas del costo presupuestado.
 */
export function rubroTable(lines: BudgetLineInput[]): RubroTable {
  const sum = (ls: BudgetLineInput[], ...cats: BudgetCategory[]) => totalOfLines(ls.filter((l) => cats.includes(l.category)));
  const row = (ls: BudgetLineInput[], rubro?: RubroId): RubroTableRow => ({
    rubro,
    materials: sum(ls, "materials"),
    labor: sum(ls, "labor"),
    design: sum(ls, "design"),
    admin: sum(ls, "admin"),
    amount: sum(ls, "transport", "contingency"),
    total: totalOfLines(ls),
  });
  const costLines = lines.filter((l) => l.category !== "financial");
  const rows = [
    ...RUBROS.map((def) => row(costLines.filter((l) => l.rubro === def.id), def.id)),
    row(costLines.filter((l) => !l.rubro)),
  ].filter((r) => r.total !== 0);
  return { rows, financial: sum(lines, "financial"), total: totalOfLines(lines) };
}

// ── Precio sugerido y rentabilidad ────────────────────────────

/** Costos agrupados como los usa la fórmula del precio (sin el gasto financiero, que depende del precio). */
export interface CostGroups {
  materials: number;
  /** Mano de obra + diseño + administración (un solo objetivo de rentabilidad: a confirmar). */
  labor: number;
  transport: number;
  contingency: number;
}

export function costGroups(lines: BudgetLineInput[]): CostGroups {
  const of = (...cats: BudgetCategory[]) => totalOfLines(lines.filter((l) => cats.includes(l.category)));
  return { materials: of("materials"), labor: of("labor", "design", "admin"), transport: of("transport"), contingency: of("contingency") };
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
 * Precio sugerido = ( Materiales / (1 − rent. materiales) + Mano de obra, diseño y administración / (1 − rent. mano de obra)
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

// ── Desglose del resumen (panel, Resultado y "Revisar y crear") ─

export interface BreakdownGroup {
  /** Costo del grupo, con su margen de seguridad si se aplicó. */
  cost: number;
  /** Parte del costo que es margen de seguridad (líneas sin rubro). */
  safetyMargin: number;
  /** Rentabilidad objetivo del grupo, en % (se edita en Resultado). */
  targetPct: number;
  /** Venta del grupo = costo / (1 − objetivo). Solo con el precio sugerido; null si el precio se escribió a mano. */
  sale: number | null;
}

export interface QuoteBreakdown {
  materials: BreakdownGroup;
  /** Mano de obra total = operarios + diseño + administración (+ margen de seguridad). */
  labor: BreakdownGroup & { operators: number; design: number; admin: number };
  transport: number;
  contingency: number;
  financial: { pct: number; amount: number };
  /** Costo total con el gasto financiero del precio. Todo sin IVA. */
  totalCost: number;
  /** Precio usado: el elegido o, si todavía no hay, el sugerido (0 si no hay ninguno). Sin IVA. */
  price: number;
  priceSource: "chosen" | "suggested" | "none";
  suggestedPrice: number | null;
  /** true si el precio es el sugerido (escrito o tomado con "Usar este precio"). */
  usesSuggested: boolean;
  profit: number | null;
  /** Rentabilidad total: ganancia / precio, en %. */
  margin: number | null;
}

/**
 * Desglose único del resumen, como la planilla de costeo del cliente: materiales y mano de obra con su costo,
 * rentabilidad y venta; transporte, imprevistos, gasto financiero; costo total, precio, ganancia y rentabilidad.
 * Lo usan el panel derecho, Resultado y "Revisar y crear".
 */
export function quoteBreakdown(lines: BudgetLineInput[], t: QuoteTargets, chosenPrice: number): QuoteBreakdown {
  const costLines = lines.filter((l) => l.category !== "financial");
  const sum = (filter: (l: BudgetLineInput) => boolean) => totalOfLines(costLines.filter(filter));
  const costs = costGroups(costLines);
  const suggested = suggestedPrice(costs, t);
  const priceSource = chosenPrice > 0 ? "chosen" : suggested ? "suggested" : "none";
  const price = chosenPrice > 0 ? chosenPrice : (suggested?.price ?? 0);
  const usesSuggested = suggested !== null && price === suggested.price;
  const analysis = analyzePrice(price, costs, t.financialPct);
  const margin = (cats: BudgetCategory[]) => sum((l) => !l.rubro && cats.includes(l.category));
  return {
    materials: {
      cost: costs.materials,
      safetyMargin: margin(["materials"]),
      targetPct: t.materialsTargetPct,
      sale: usesSuggested && suggested ? suggested.materialsPrice : null,
    },
    labor: {
      cost: costs.labor,
      operators: sum((l) => !!l.rubro && l.category === "labor"),
      design: sum((l) => !!l.rubro && l.category === "design"),
      admin: sum((l) => !!l.rubro && l.category === "admin"),
      safetyMargin: margin(["labor", "design", "admin"]),
      targetPct: t.laborTargetPct,
      sale: usesSuggested && suggested ? suggested.laborPrice : null,
    },
    transport: costs.transport,
    contingency: costs.contingency,
    financial: { pct: t.financialPct, amount: analysis.financialCost },
    totalCost: analysis.totalCost,
    price,
    priceSource,
    suggestedPrice: suggested?.price ?? null,
    usesSuggested,
    profit: price > 0 ? round2(price - analysis.totalCost) : null,
    margin: analysis.totalMargin,
  };
}

/** Suma `days` días hábiles (lun–vie) a una fecha ISO yyyy-mm-dd. */
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
