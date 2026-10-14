// Lote 4 — cotización por rubros: líneas, tarifas, horas extra, precio sugerido y gasto financiero.
import { describe, expect, it } from "vitest";
import type { HourRate } from "@/types";
import {
  addWorkingDays,
  analyzePrice,
  averageDailyLaborCost,
  costGroups,
  delayAnalysis,
  financialLine,
  materialBudgetQuantity,
  ratesByCategory,
  rubroLabor,
  rubroLines,
  suggestedPrice,
  totalOfLines,
  workSchedule,
  type QuoteRubro,
} from "@/lib/budget-calculator";
import { computeCalculator, initialCalcState, newRubroRow, type CalcState, type RubroRow } from "@/components/budget/calculator-state";
import { benchmarksForType, suggestedAdjustments } from "@/lib/historical-benchmarks";
import { DEFAULT_FINANCIAL_PCT, DEFAULT_HOUR_RATES } from "@/lib/constants";
import { RUBROS } from "@/lib/rubros";
import { line, project, usage } from "./helpers";

const RATES: HourRate[] = DEFAULT_HOUR_RATES; // Mano de obra $19.000 · Diseño $27.000 · Administración $27.000
const rates = ratesByCategory(RATES);

const madera: QuoteRubro = {
  rubro: "carpinteria_madera",
  materials: [{ materialId: "mel-blanca-18", name: "Melamina blanca 18 mm", unit: "placa", quantity: 10, unitCost: 50_000, wastePct: 10 }],
  workers: 2,
  hoursPerWorker: 40,
  designHours: 6,
  adminHours: 4,
  amount: 0,
};
const amount = (rubro: QuoteRubro["rubro"], value: number): QuoteRubro => ({ rubro, materials: [], workers: 0, hoursPerWorker: 0, designHours: 0, adminHours: 0, amount: value });
const full = { normalShare: 1, laborRate: 19_000, designRate: 27_000, adminRate: 27_000, overtimeMultiplier: 2 };

describe("catálogo de rubros", () => {
  it("es cerrado: trece rubros, y solo Transporte / Fletes e Imprevistos son un importe", () => {
    expect(RUBROS).toHaveLength(13);
    expect(RUBROS.filter((r) => r.kind === "amount").map((r) => r.label)).toEqual(["Transporte / Fletes", "Imprevistos"]);
  });
  it("tarifas iniciales: Mano de obra $19.000, Diseño $27.000 y Administración $27.000; gasto financiero 5%", () => {
    expect(DEFAULT_HOUR_RATES.map((r) => [r.name, r.hourlyRate, r.category])).toEqual([
      ["Mano de obra", 19_000, "labor"],
      ["Diseño", 27_000, "design"],
      ["Administración", 27_000, "admin"],
    ]);
    expect(DEFAULT_FINANCIAL_PCT).toBe(5);
  });
});

describe("cálculo por rubro", () => {
  it("materiales con desperdicio, operarios × horas por operario, diseño y administración por separado", () => {
    expect(materialBudgetQuantity(madera.materials[0])).toBe(11);
    const labor = rubroLabor(madera, full);
    expect(labor).toMatchObject({
      normalHours: 80,
      overtimeHours: 0,
      normalCost: 1_520_000,
      design: { hours: 6, rate: 27_000, cost: 162_000 },
      admin: { hours: 4, rate: 27_000, cost: 108_000 },
      total: 1_790_000,
    });
    const lines = rubroLines(madera, labor, rates, 2);
    expect(lines.map((l) => [l.category, l.rubro, l.quantity, l.unitCost])).toEqual([
      ["materials", "carpinteria_madera", 11, 50_000],
      ["labor", "carpinteria_madera", 80, 19_000],
      ["design", "carpinteria_madera", 6, 27_000],
      ["admin", "carpinteria_madera", 4, 27_000],
    ]);
    expect(totalOfLines(lines)).toBe(550_000 + 1_520_000 + 270_000);
  });

  it("cada hora guarda el tipo de hora y la tarifa vigente (congelada en la línea)", () => {
    const [, laborLine, designLine, adminLine] = rubroLines(madera, rubroLabor(madera, full), rates, 2);
    expect(designLine).toMatchObject({ hourRateId: "design", unitCost: 27_000 });
    expect(laborLine).toMatchObject({ hourRateId: "labor", hourType: "normal", unitCost: 19_000 });
    expect(adminLine).toMatchObject({ hourRateId: "admin", unitCost: 27_000 });
    expect(laborLine.notes).toContain("vigente al cotizar");
  });

  it("un material comprado hecho: cantidad 1 y el costo total", () => {
    const r: QuoteRubro = { ...madera, materials: [{ name: "Vidrio templado cortado", unit: "u", quantity: 1, unitCost: 480_000, wastePct: 0 }], workers: 0, designHours: 0, adminHours: 0 };
    const lines = rubroLines({ ...r, rubro: "vidrios" }, rubroLabor(r, full), rates, 2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ category: "materials", rubro: "vidrios", quantity: 1, unitCost: 480_000 });
  });

  it("Transporte / Fletes e Imprevistos son solo un importe, en su categoría", () => {
    expect(rubroLines(amount("transporte", 100_000), null, rates, 2)).toEqual([
      { category: "transport", rubro: "transporte", description: "Transporte / Fletes", quantity: null, unit: "global", unitCost: 100_000 },
    ]);
    expect(rubroLines(amount("imprevistos", 50_000), null, rates, 2)[0].category).toBe("contingency");
    expect(rubroLines(amount("imprevistos", 0), null, rates, 2)).toEqual([]);
  });

  it("ignora materiales sin descripción o sin cantidad", () => {
    const r = { ...madera, materials: [{ name: "", unit: "u", quantity: 3, unitCost: 1, wastePct: 0 }, { name: "Algo", unit: "u", quantity: 0, unitCost: 1, wastePct: 0 }] };
    expect(rubroLines(r, null, rates, 2).some((l) => l.category === "materials")).toBe(false);
  });

  it("el costo cambia cuando cambian las horas o las tarifas", () => {
    const base = rubroLabor(madera, full).total;
    expect(rubroLabor({ ...madera, hoursPerWorker: 50 }, full).total).toBe(base + 2 * 10 * 19_000);
    expect(rubroLabor(madera, { ...full, laborRate: 20_000 }).total).toBe(base + 80 * 1_000);
    expect(rubroLabor(madera, { ...full, adminRate: 30_000 }).total).toBe(base + 4 * 3_000);
  });

  it("cambiar la tarifa de Diseño no cambia Administración (y al revés)", () => {
    const base = rubroLabor(madera, full);
    const design = rubroLabor(madera, { ...full, designRate: 40_000 });
    expect(design.design.cost).toBe(6 * 40_000);
    expect(design.admin).toEqual(base.admin);
    const admin = rubroLabor(madera, { ...full, adminRate: 10_000 });
    expect(admin.admin.cost).toBe(4 * 10_000);
    expect(admin.design).toEqual(base.design);
    expect(admin.normalCost).toBe(base.normalCost);
  });
});

describe("días de trabajo y horas extra con N operarios", () => {
  // Lunes 5/10/2026.
  const START = "2026-10-05";

  it("días de trabajo = horas por operario / jornada, rubros uno detrás de otro", () => {
    const s = workSchedule([madera, { ...madera, rubro: "pintura", hoursPerWorker: 24 }], 8, START, null);
    expect(s).toMatchObject({ neededDays: 8, workDays: 8, availableDays: null, fits: null, normalShare: 1 });
  });

  it("si entra en la fecha de entrega, no hay horas extra", () => {
    const s = workSchedule([madera, { ...madera, rubro: "pintura", hoursPerWorker: 24 }], 8, START, "2026-10-14");
    expect(s).toMatchObject({ availableDays: 8, fits: true, normalShare: 1 });
  });

  it("si no entra, las horas por operario que no entran son horas extra con el multiplicador", () => {
    const s = workSchedule([madera], 8, START, "2026-10-07"); // 5 días de trabajo, 3 disponibles
    expect(s).toMatchObject({ workDays: 5, availableDays: 3, fits: false });
    expect(s.normalShare).toBeCloseTo(0.6);
    const l = rubroLabor(madera, { ...full, normalShare: s.normalShare });
    expect(l).toMatchObject({ normalHoursPerWorker: 24, overtimeHoursPerWorker: 16, normalHours: 48, overtimeHours: 32, overtimeRate: 38_000 });
    expect(l.normalCost + l.overtimeCost).toBe(48 * 19_000 + 32 * 38_000);
    const lines = rubroLines(madera, l, rates, 2).filter((x) => x.category === "labor");
    expect(lines.map((x) => [x.hourType, x.quantity, x.unitCost])).toEqual([
      ["normal", 48, 19_000],
      ["overtime", 32, 38_000],
    ]);
  });

  it("con multiplicador 1,5 la hora extra cuesta menos", () => {
    const l = rubroLabor(madera, { ...full, normalShare: 0.6, overtimeMultiplier: 1.5 });
    expect(l.overtimeRate).toBe(28_500);
    expect(l.overtimeCost).toBe(32 * 28_500);
  });

  it("acortar la fecha de entrega sube el costo", () => {
    const cost = (deadline: string) => rubroLabor(madera, { ...full, normalShare: workSchedule([madera], 8, START, deadline).normalShare }).total;
    expect(cost("2026-10-09")).toBe(1_790_000); // entra justo
    expect(cost("2026-10-07")).toBeGreaterThan(cost("2026-10-09"));
    expect(cost("2026-10-05")).toBeGreaterThan(cost("2026-10-07"));
  });

  it("el día promedio de trabajo sale de la mano de obra en horario normal", () => {
    expect(averageDailyLaborCost([rubroLabor(madera, full)], 5)).toBe(1_520_000 / 5);
    expect(averageDailyLaborCost([], 0)).toBe(0);
  });
});

describe("precio sugerido con rentabilidad separada y gasto financiero", () => {
  it("caso simple conocido: 700 de materiales al 30% y 600 de mano de obra al 40% → 2.000", () => {
    const s = suggestedPrice({ materials: 700, labor: 600, transport: 0, contingency: 0 }, { materialsTargetPct: 30, laborTargetPct: 40, financialPct: 0 })!;
    expect(s.price).toBe(2_000);
    expect(s.materialsMargin).toBeCloseTo(30);
    expect(s.laborMargin).toBeCloseTo(40);
    expect(s.totalMargin).toBeCloseTo(35);
  });

  it("el gasto financiero divide todo por (1 − %) y aparece como costo", () => {
    const s = suggestedPrice({ materials: 700, labor: 600, transport: 0, contingency: 0 }, { materialsTargetPct: 30, laborTargetPct: 40, financialPct: 5 })!;
    expect(s.price).toBe(2_106); // ⌈2.000 / 0,95⌉
    expect(s.financialCost).toBeCloseTo(105.3);
    expect(s.totalCost).toBeCloseTo(1_405.3);
    expect(s.totalMargin).toBeCloseTo(33.27, 2);
  });

  it("caso completo: transporte e imprevistos van al costo sin rentabilidad", () => {
    const costs = { materials: 550_000, labor: 1_790_000, transport: 100_000, contingency: 50_000 };
    const s = suggestedPrice(costs, { materialsTargetPct: 30, laborTargetPct: 40, financialPct: 5 })!;
    expect(s.materialsPrice).toBeCloseTo(785_714.29);
    expect(s.laborPrice).toBeCloseTo(2_983_333.33);
    expect(s.price).toBe(4_125_314);
    expect(s.financialCost).toBeCloseTo(206_265.7);
    expect(s.totalMargin).toBeCloseTo(34.64, 2);
  });

  it("cambia cuando cambian los porcentajes", () => {
    const costs = { materials: 700, labor: 600, transport: 0, contingency: 0 };
    const base = suggestedPrice(costs, { materialsTargetPct: 30, laborTargetPct: 40, financialPct: 5 })!.price;
    expect(suggestedPrice(costs, { materialsTargetPct: 35, laborTargetPct: 40, financialPct: 5 })!.price).toBeGreaterThan(base);
    expect(suggestedPrice(costs, { materialsTargetPct: 30, laborTargetPct: 30, financialPct: 5 })!.price).toBeLessThan(base);
    expect(suggestedPrice(costs, { materialsTargetPct: 30, laborTargetPct: 40, financialPct: 8 })!.price).toBeGreaterThan(base);
  });

  it("sin costo o con un porcentaje de 100% o más no hay precio sugerido", () => {
    const t = { materialsTargetPct: 30, laborTargetPct: 40, financialPct: 5 };
    expect(suggestedPrice({ materials: 0, labor: 0, transport: 0, contingency: 0 }, t)).toBeNull();
    expect(suggestedPrice({ materials: 700, labor: 0, transport: 0, contingency: 0 }, { ...t, materialsTargetPct: 100 })).toBeNull();
    expect(suggestedPrice({ materials: 700, labor: 0, transport: 0, contingency: 0 }, { ...t, financialPct: 100 })).toBeNull();
  });

  it("con un precio escrito a mano se calcula la rentabilidad total (el gasto financiero sale de ese precio)", () => {
    const a = analyzePrice(2_500, { materials: 700, labor: 600, transport: 0, contingency: 0 }, 5);
    expect(a.financialCost).toBe(125);
    expect(a.totalCost).toBe(1_425);
    expect(a.totalMargin).toBeCloseTo(43);
  });

  it("línea de gasto financiero: % del precio de venta, sin rubro; sin precio no hay línea", () => {
    expect(financialLine(5, 2_000)).toMatchObject({ category: "financial", quantity: null, unitCost: 100 });
    expect(financialLine(5, 2_000)?.rubro).toBeUndefined();
    expect(financialLine(5, 0)).toBeNull();
  });

  it("diseño y administración cuentan como mano de obra para el precio (a confirmar)", () => {
    const lines = rubroLines(madera, rubroLabor(madera, full), rates, 2);
    expect(costGroups(lines)).toEqual({ materials: 550_000, labor: 1_790_000, transport: 0, contingency: 0 });
  });
});

describe("de la calculadora al costo presupuestado", () => {
  const row = (patch: Partial<RubroRow>): RubroRow => ({ ...newRubroRow("carpinteria_madera"), ...patch });
  const state: CalcState = {
    ...initialCalcState(5),
    materialsTargetPct: "30",
    laborTargetPct: "40",
    rubros: [
      row({ materials: [{ key: "m1", name: "Melamina blanca 18 mm", unit: "placa", quantity: "10", unitCost: "50000", wastePct: "10" }], workers: "2", hoursPerWorker: "40", designHours: "6", adminHours: "4" }),
      { ...newRubroRow("transporte"), amount: "100000" },
      { ...newRubroRow("imprevistos"), amount: "50000" },
    ],
  };
  const ctx = { projects: [], rates: RATES, overtimeMultiplier: 2, deadline: "", salesPrice: 0 };

  it("sin precio: líneas por rubro, sin gasto financiero todavía; con precio, aparece la línea", () => {
    const c = computeCalculator(state, "2026-10-05", "Local comercial", ctx);
    expect(c.total).toBe(2_490_000);
    expect(c.suggested?.price).toBe(4_125_314);
    expect(c.lines.some((l) => l.category === "financial")).toBe(false);
    const priced = computeCalculator(state, "2026-10-05", "Local comercial", { ...ctx, salesPrice: c.suggested!.price });
    expect(priced.lines.find((l) => l.category === "financial")?.unitCost).toBeCloseTo(206_265.7);
    expect(priced.total).toBeCloseTo(priced.atPrice!.totalCost);
    expect(priced.atPrice!.totalMargin).toBeCloseTo(34.64, 2);
  });

  it("las tarifas de Configuración se aplican al cotizar y quedan en la línea", () => {
    const raised = RATES.map((r) => (r.id === "labor" ? { ...r, hourlyRate: 25_000 } : r));
    const c = computeCalculator(state, "2026-10-05", "Local comercial", { ...ctx, rates: raised });
    expect(c.lines.find((l) => l.category === "labor")).toMatchObject({ unitCost: 25_000, hourRateId: "labor" });
    expect(c.total).toBe(2_490_000 + 80 * 6_000);
  });

  it("con fecha de entrega corta, las horas extra suman a Mano de obra", () => {
    const c = computeCalculator(state, "2026-10-05", "Local comercial", { ...ctx, deadline: "2026-10-07" });
    expect(c.schedule.fits).toBe(false);
    const labor = c.lines.filter((l) => l.category === "labor");
    expect(labor.map((l) => l.hourType)).toEqual(["normal", "overtime"]);
    expect(c.costs.labor).toBe(48 * 19_000 + 32 * 38_000 + 270_000);
  });

  it("cada línea guarda su rubro (salvo el gasto financiero)", () => {
    const c = computeCalculator(state, "2026-10-05", "Local comercial", { ...ctx, salesPrice: 4_000_000 });
    expect(c.lines.filter((l) => l.category !== "financial").every((l) => l.rubro)).toBe(true);
  });
});

describe("sensibilidad al atraso", () => {
  it("la rentabilidad baja con cada día extra", () => {
    const a = delayAnalysis({ baseCost: 700_000, salesPrice: 1_000_000, dailyCost: 160_000, targetMarginPct: 30 });
    expect(a.points[0].margin).toBeCloseTo(30);
    expect(a.points[1].margin).toBeCloseTo(14);
    expect(a.extraDaysBeforeTarget).toBe(0);
    expect(a.extraDaysToBreakEven).toBe(1);
  });
  it("si el precio deja colchón, informa cuántos días se pueden absorber", () => {
    expect(delayAnalysis({ baseCost: 500_000, salesPrice: 1_000_000, dailyCost: 50_000, targetMarginPct: 30 }).extraDaysBeforeTarget).toBe(4);
  });
  it("sin precio no inventa resultados", () => {
    expect(delayAnalysis({ baseCost: 500_000, salesPrice: 0, dailyCost: 50_000, targetMarginPct: 30 }).extraDaysBeforeTarget).toBeNull();
  });
  it("fecha + días laborales salta fines de semana", () => {
    expect(addWorkingDays("2026-10-05", 5)).toBe("2026-10-12");
    expect(addWorkingDays("2026-10-09", 1)).toBe("2026-10-12");
  });
});

describe("benchmarks de proyectos anteriores", () => {
  const done = (type: string, budget: number, actual: number) =>
    project({
      status: "completed",
      projectType: type,
      budgetLines: [line("materials", null, budget)],
      materialUsages: [usage({ quantityConsumed: actual / 50_000, unitCost: 50_000 })],
    });

  it("promedia el desvío por categoría solo de proyectos finalizados del mismo tipo", () => {
    const b = benchmarksForType(
      [done("Local comercial", 100_000, 110_000), done("Local comercial", 100_000, 106_000), done("Stand", 100_000, 200_000), project({ projectType: "Local comercial" })],
      "Local comercial",
    );
    expect(b.sampleSize).toBe(2);
    expect(b.byCategory.find((c) => c.category === "materials")?.avgOverrunPct).toBeCloseTo(8);
    expect(suggestedAdjustments(b)).toHaveLength(1);
  });

  it("no sugiere ajustes de imprevistos ni de gasto financiero", () => {
    const p = project({ status: "completed", budgetLines: [line("financial", null, 100)], actualEntries: [{ id: "a", projectId: "p", date: "2026-01-02", type: "other", category: "financial", description: "x", amount: 150, createdBy: "t", createdAt: "x" }] });
    expect(suggestedAdjustments(benchmarksForType([p], "Local comercial"))).toEqual([]);
  });
});
