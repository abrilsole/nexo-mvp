// Estado de la cotización por rubros (campos como texto para permitir vacíos) y su conversión a números.
// Lo usan el Cotizador y Nuevo proyecto: los dos muestran la misma calculadora con el mismo resultado.
import type { BudgetCategory, HourRate, Project, RubroId } from "@/types";
import {
  adjustmentLines,
  financialLine,
  quoteBreakdown,
  ratesByCategory,
  rubroLabor,
  rubroLines,
  totalOfLines,
  workSchedule,
  type CalcAdjustment,
  type QuoteBreakdown,
  type QuoteInput,
  type QuoteMaterial,
  type RatesByCategory,
  type RubroLabor,
  type WorkSchedule,
} from "@/lib/budget-calculator";
import { delayAnalysis, type DelayResult } from "@/lib/delay";
import { benchmarksForType, learningInsights, type LearningInsight } from "@/lib/historical-benchmarks";
import type { BudgetLineInput } from "@/lib/project-operations";
import { CATEGORY_LABELS, DEFAULT_FINANCIAL_PCT, HOUR_CATEGORIES, MATERIAL_CATALOG } from "@/lib/constants";
import { formatCurrency, formatNumber, formatWorkingDays } from "@/lib/formatting";
import { rubroDef } from "@/lib/rubros";
import { parseDecimal } from "@/lib/schemas";

export interface MaterialRow {
  key: string;
  name: string;
  unit: string;
  quantity: string;
  unitCost: string;
  wastePct: string;
}

/** Un rubro en edición. Lista plana y serializable: un conjunto de rubros se puede guardar como plantilla. */
export interface RubroRow {
  key: string;
  rubro: RubroId;
  materials: MaterialRow[];
  workers: string;
  hoursPerWorker: string;
  designHours: string;
  adminHours: string;
  /** Solo rubros de importe (Transporte / Fletes, Imprevistos). */
  amount: string;
}

export interface CalcState {
  rubros: RubroRow[];
  /** Plazo en días hábiles (opcional). Sin plazo no hay horas extra. */
  deadlineDays: string;
  materialsTargetPct: string;
  laborTargetPct: string;
  financialPct: string;
  /** Márgenes de seguridad aplicados desde el aprendizaje (% editable). */
  safetyMargins: SafetyMarginRow[];
  /** Atraso: multa o costo por día (opcional). */
  delayPenalty: string;
  /** Atraso: piso de rentabilidad en % ("" = la rentabilidad total del precio sugerido). */
  delayFloorPct: string;
}

/** Margen de seguridad aplicado: el % se puede editar; la referencia queda para que sea trazable. */
export interface SafetyMarginRow {
  category: BudgetCategory;
  pct: string;
  /** Desvío promedio de los proyectos comparables al aplicarlo, en %. */
  referencePct: number;
  sampleSize: number;
  projectType: string;
}

let seq = 0;
const rowKey = () => `r${Date.now()}${(seq += 1)}`;

/** Lo más simple: cantidad 1 y el costo total alcanza para algo que se compra hecho. */
export const newMaterialRow = (): MaterialRow => ({ key: rowKey(), name: "", unit: "u", quantity: "1", unitCost: "", wastePct: "0" });

export function newRubroRow(rubro: RubroId): RubroRow {
  const full = rubroDef(rubro).kind === "full";
  return { key: rowKey(), rubro, materials: full ? [newMaterialRow()] : [], workers: full ? "1" : "", hoursPerWorker: "", designHours: "", adminHours: "", amount: "" };
}

export function initialCalcState(financialPct = DEFAULT_FINANCIAL_PCT): CalcState {
  return {
    rubros: [newRubroRow("carpinteria_madera")],
    deadlineDays: "",
    materialsTargetPct: "30",
    laborTargetPct: "30",
    financialPct: String(financialPct).replace(".", ","),
    safetyMargins: [],
    delayPenalty: "",
    delayFloorPct: "",
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const n = (s: string) => {
  const v = parseDecimal(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** Lo que la calculadora necesita además de lo que se tipea. */
export interface CalculatorContext {
  projects: Project[];
  rates: HourRate[];
  overtimeMultiplier: number;
  /** Jornada del operario (Configuración): queda congelada en las líneas de horas. */
  hoursPerDay: number;
  /** Precio de venta elegido (0 = todavía no): de él sale el gasto financiero. */
  salesPrice: number;
  /** Empresa demo: el aprendizaje se muestra aunque haya pocos proyectos, rotulado. */
  isDemo: boolean;
}

/** Una fila de material en edición → material de la cotización (con su id de catálogo si coincide el nombre). */
export function materialRowToQuote(m: MaterialRow): QuoteMaterial {
  return {
    materialId: MATERIAL_CATALOG.find((c) => c.name.toLowerCase() === m.name.trim().toLowerCase())?.id,
    name: m.name,
    unit: m.unit,
    quantity: n(m.quantity),
    unitCost: n(m.unitCost),
    wastePct: n(m.wastePct),
  };
}

function calcStateToInput(s: CalcState, ctx: Pick<CalculatorContext, "rates" | "overtimeMultiplier" | "hoursPerDay">): QuoteInput {
  return {
    rubros: s.rubros.map((r) => ({
      rubro: r.rubro,
      materials: r.materials.map(materialRowToQuote),
      workers: Math.round(n(r.workers)),
      hoursPerWorker: n(r.hoursPerWorker),
      designHours: n(r.designHours),
      adminHours: n(r.adminHours),
      amount: n(r.amount),
    })),
    hoursPerDay: ctx.hoursPerDay,
    deadlineDays: n(s.deadlineDays) || null,
    rates: ctx.rates,
    overtimeMultiplier: ctx.overtimeMultiplier,
    materialsTargetPct: n(s.materialsTargetPct),
    laborTargetPct: n(s.laborTargetPct),
    financialPct: n(s.financialPct),
  };
}

const toAdjustments = (margins: SafetyMarginRow[]): CalcAdjustment[] =>
  margins.map((m) => ({ category: m.category, pct: n(m.pct), referencePct: m.referencePct, sampleSize: m.sampleSize, projectType: m.projectType }));

/** Margen de seguridad a partir de una línea de aprendizaje: arranca con el desvío promedio (1 decimal). */
export function safetyMarginFrom(insight: LearningInsight, projectType: string): SafetyMarginRow {
  const pct = Math.round(insight.avgOverrunPct * 10) / 10;
  return { category: insight.category, pct: String(pct).replace(".", ","), referencePct: insight.avgOverrunPct, sampleSize: insight.sampleSize, projectType };
}

export interface RubroResult {
  key: string;
  rubro: RubroId;
  /** null en rubros de importe. */
  labor: RubroLabor | null;
  lines: BudgetLineInput[];
  total: number;
}

export interface CalculatorResult {
  input: QuoteInput;
  rubros: RubroResult[];
  schedule: WorkSchedule;
  /** Horas extra de mano de obra de todos los rubros (0 si los días de trabajo entran). */
  overtimeHours: number;
  /** Todas las líneas del costo presupuestado (rubros + ajustes + gasto financiero). */
  lines: BudgetLineInput[];
  total: number;
  /** Desglose del resumen (panel, Resultado y "Revisar y crear"). */
  breakdown: QuoteBreakdown;
  /** Tarifas usadas (undefined = no hay tipo de hora de esa categoría). */
  rates: RatesByCategory;
  /** Aprendizaje de proyectos anteriores (vacío con menos de 3 comparables, salvo en la demo). */
  insights: LearningInsight[];
  hasContent: boolean;
  /** N del cálculo de atraso: el equipo más grande previsto (máximo de operarios de un rubro). */
  crewSize: number;
  /** ¿Qué pasa si el proyecto se alarga? null sin precio de venta o sin costo. */
  delay: DelayResult | null;
}

/** Todo lo derivado de la cotización en un solo lugar (el Cotizador y Nuevo proyecto usan el mismo resultado). */
export function computeCalculator(state: CalcState, projectType: string, ctx: CalculatorContext): CalculatorResult {
  const input = calcStateToInput(state, ctx);
  const rates = ratesByCategory(ctx.rates);
  const schedule = workSchedule(input.rubros, input.hoursPerDay, input.deadlineDays);
  const rubros = input.rubros.map((r, i): RubroResult => {
    const labor =
      rubroDef(r.rubro).kind === "full"
        ? rubroLabor(r, {
            normalShare: schedule.normalShare,
            laborRate: rates.labor?.hourlyRate ?? 0,
            designRate: rates.design?.hourlyRate ?? 0,
            adminRate: rates.admin?.hourlyRate ?? 0,
            overtimeMultiplier: input.overtimeMultiplier,
          })
        : null;
    const lines = rubroLines(r, labor, { rates, overtimeMultiplier: input.overtimeMultiplier, hoursPerDay: input.hoursPerDay });
    return { key: state.rubros[i].key, rubro: r.rubro, labor, lines, total: totalOfLines(lines) };
  });
  const rubroLinesAll = rubros.flatMap((r) => r.lines);
  const withAdjustments = [...rubroLinesAll, ...adjustmentLines(rubroLinesAll, toAdjustments(state.safetyMargins))];
  const financial = financialLine(input.financialPct, ctx.salesPrice);
  const lines = financial ? [...withAdjustments, financial] : withAdjustments;
  const total = totalOfLines(lines);
  const breakdown = quoteBreakdown(lines, input, ctx.salesPrice);
  const suggestedMargin = breakdown.suggestedPrice !== null ? quoteBreakdown(lines, input, breakdown.suggestedPrice).margin : null;
  const crewSize = Math.max(0, ...input.rubros.map((r) => r.workers));
  const floor = state.delayFloorPct.trim() ? parseDecimal(state.delayFloorPct) : NaN; // vacío = rentabilidad del precio sugerido
  const delay = delayAnalysis({
    price: ctx.salesPrice,
    cost: total,
    workers: crewSize,
    hoursPerDay: input.hoursPerDay,
    laborRate: rates.labor?.hourlyRate ?? 0,
    dailyPenalty: n(state.delayPenalty),
    floorPct: Number.isFinite(floor) ? floor : (suggestedMargin ?? 0),
    workDays: schedule.workDays,
  });
  return {
    input,
    rubros,
    schedule,
    overtimeHours: round2(rubros.reduce((s, r) => s + (r.labor?.overtimeHours ?? 0), 0)),
    lines,
    total,
    breakdown,
    rates,
    insights: learningInsights(benchmarksForType(ctx.projects, projectType), { isDemo: ctx.isDemo }),
    hasContent: withAdjustments.length > 0,
    crewSize,
    delay,
  };
}

/** "Mano de obra $ 19.000/h · Diseño $ 27.000/h · Administración $ 27.000/h": las tarifas que usa la cotización. */
export function ratesText(rates: RatesByCategory): string {
  return HOUR_CATEGORIES.map((c) => `${rates[c]?.name ?? CATEGORY_LABELS[c]} ${formatCurrency(rates[c]?.hourlyRate ?? 0)}/h`).join(" · ");
}

/** Avisos del paso de revisión, en un solo lugar. */
export function reviewWarnings(calc: CalculatorResult, salesPrice: number): string[] {
  const out: string[] = [];
  const { schedule, breakdown, rates } = calc;
  if (!calc.hasContent) out.push("Falta cargar el costo: no hay materiales, horas ni importes.");
  if (!(salesPrice > 0)) out.push("Falta el precio de venta.");
  const missingRates = HOUR_CATEGORIES.filter((c) => !rates[c]?.hourlyRate);
  if (missingRates.length > 0) out.push("Falta la tarifa de algún tipo de hora: cargala en Configuración para que esas horas sumen al costo.");
  if (schedule.fits === false) {
    out.push(
      `Los días de trabajo estimados (${formatWorkingDays(schedule.workDays)}) no entran en el plazo (${formatWorkingDays(schedule.availableDays ?? 0)}): ` +
        `${formatNumber(calc.overtimeHours, 1)} h se calculan como horas extra.`,
    );
  }
  if (breakdown.priceSource === "chosen" && breakdown.suggestedPrice !== null && !breakdown.usesSuggested) {
    out.push(`El precio fue escrito a mano (el sugerido es ${formatCurrency(breakdown.suggestedPrice)}): el desglose de rentabilidad por materiales y mano de obra solo aplica al precio sugerido.`);
  }
  return out;
}

/** Por qué todavía no se puede seguir (crear el proyecto o continuar). null = se puede. */
export function quoteActionBlocker(calc: CalculatorResult, salesPrice: number): string | null {
  if (!calc.hasContent) return "Cargá al menos un costo.";
  if (!(salesPrice > 0)) return "Definí el precio de venta (podés usar el sugerido).";
  return null;
}
