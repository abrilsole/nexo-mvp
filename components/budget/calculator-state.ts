// Estado de la cotización por rubros (campos como texto para permitir vacíos) y su conversión a números.
// Lo usan el Cotizador y Nuevo proyecto: los dos muestran la misma calculadora con el mismo resultado.
import type { BudgetCategory, HourRate, Project, RubroId } from "@/types";
import {
  adjustmentLines,
  analyzePrice,
  costGroups,
  financialLine,
  ratesByCategory,
  rubroLabor,
  rubroLines,
  suggestedPrice,
  totalOfLines,
  workSchedule,
  type CalcAdjustment,
  type CostGroups,
  type PriceAnalysis,
  type QuoteInput,
  type RatesByCategory,
  type RubroLabor,
  type SuggestedPrice,
  type WorkSchedule,
} from "@/lib/budget-calculator";
import { delayAnalysis, type DelayResult } from "@/lib/delay";
import { benchmarksForType, suggestedAdjustments, type CategoryBenchmark, type TypeBenchmarks } from "@/lib/historical-benchmarks";
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
  /** Categorías cuyo ajuste por historial el usuario decidió aplicar. */
  appliedAdjustments: BudgetCategory[];
  /** Atraso: multa o costo por día (opcional). */
  delayPenalty: string;
  /** Atraso: piso de rentabilidad en % ("" = la rentabilidad total del precio sugerido). */
  delayFloorPct: string;
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
    appliedAdjustments: [],
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
}

function calcStateToInput(s: CalcState, ctx: Pick<CalculatorContext, "rates" | "overtimeMultiplier" | "hoursPerDay">): QuoteInput {
  return {
    rubros: s.rubros.map((r) => ({
      rubro: r.rubro,
      materials: r.materials.map((m) => ({
        materialId: MATERIAL_CATALOG.find((c) => c.name.toLowerCase() === m.name.trim().toLowerCase())?.id,
        name: m.name,
        unit: m.unit,
        quantity: n(m.quantity),
        unitCost: n(m.unitCost),
        wastePct: n(m.wastePct),
      })),
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

function toAdjustments(
  applied: BudgetCategory[],
  suggestions: { category: BudgetCategory; avgOverrunPct: number; sampleSize: number }[],
  projectType: string,
): CalcAdjustment[] {
  return suggestions
    .filter((s) => applied.includes(s.category))
    .map((s) => ({ category: s.category, pct: Math.round(s.avgOverrunPct * 10) / 10, sampleSize: s.sampleSize, projectType }));
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
  costs: CostGroups;
  suggested: SuggestedPrice | null;
  /** Rentabilidad con el precio elegido (null sin precio). */
  atPrice: PriceAnalysis | null;
  /** Tarifas usadas (undefined = no hay tipo de hora de esa categoría). */
  rates: RatesByCategory;
  benchmarks: TypeBenchmarks;
  suggestions: CategoryBenchmark[];
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
  const benchmarks = benchmarksForType(ctx.projects, projectType);
  const suggestions = suggestedAdjustments(benchmarks);
  const rubroLinesAll = rubros.flatMap((r) => r.lines);
  const withAdjustments = [...rubroLinesAll, ...adjustmentLines(rubroLinesAll, toAdjustments(state.appliedAdjustments, suggestions, projectType))];
  const costs = costGroups(withAdjustments);
  const financial = financialLine(input.financialPct, ctx.salesPrice);
  const lines = financial ? [...withAdjustments, financial] : withAdjustments;
  const total = totalOfLines(lines);
  const suggested = suggestedPrice(costs, input);
  const crewSize = Math.max(0, ...input.rubros.map((r) => r.workers));
  const floor = parseDecimal(state.delayFloorPct);
  const delay = delayAnalysis({
    price: ctx.salesPrice,
    cost: total,
    workers: crewSize,
    hoursPerDay: input.hoursPerDay,
    laborRate: rates.labor?.hourlyRate ?? 0,
    dailyPenalty: n(state.delayPenalty),
    floorPct: Number.isFinite(floor) ? floor : (suggested?.totalMargin ?? 0),
  });
  return {
    input,
    rubros,
    schedule,
    overtimeHours: round2(rubros.reduce((s, r) => s + (r.labor?.overtimeHours ?? 0), 0)),
    lines,
    total,
    costs,
    suggested,
    atPrice: ctx.salesPrice > 0 ? analyzePrice(ctx.salesPrice, costs, input.financialPct) : null,
    rates,
    benchmarks,
    suggestions,
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
  const { schedule, suggested, rates } = calc;
  if (!calc.hasContent) out.push("Falta cargar el costo: no hay materiales, horas ni importes.");
  if (!(salesPrice > 0)) out.push("Falta el precio de venta.");
  const missingRates = HOUR_CATEGORIES.filter((c) => !rates[c]?.hourlyRate);
  if (missingRates.length > 0) out.push("Falta la tarifa de algún tipo de hora: cargala en Configuración para que esas horas sumen al costo.");
  if (schedule.fits === false) {
    out.push(
      `Los días de trabajo estimados (${formatWorkingDays(schedule.workDays)}) no entran en el plazo (${formatWorkingDays(schedule.availableDays ?? 0)} hábiles): ` +
        `${formatNumber(calc.overtimeHours, 1)} h se calculan como horas extra.`,
    );
  }
  if (salesPrice > 0 && suggested && salesPrice !== suggested.price) {
    out.push(`El precio fue escrito a mano (el sugerido es ${formatCurrency(suggested.price)}): el desglose de rentabilidad por materiales y mano de obra solo aplica al precio sugerido.`);
  }
  return out;
}

/** Por qué todavía no se puede seguir (crear el proyecto o continuar). null = se puede. */
export function quoteActionBlocker(calc: CalculatorResult, salesPrice: number): string | null {
  if (!calc.hasContent) return "Cargá al menos un costo.";
  if (!(salesPrice > 0)) return "Definí el precio de venta (podés usar el sugerido).";
  return null;
}
