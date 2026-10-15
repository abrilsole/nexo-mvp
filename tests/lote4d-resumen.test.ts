// Lote 4d — desglose único del resumen, margen de seguridad trazable y aprendizaje de proyectos anteriores.
import { describe, expect, it } from "vitest";
import { quoteBreakdown } from "@/lib/budget-calculator";
import { benchmarksForType, learningInsights, MIN_LEARNING_PROJECTS } from "@/lib/historical-benchmarks";
import { DEFAULT_HOUR_RATES } from "@/lib/constants";
import { computeCalculator, initialCalcState, newRubroRow, safetyMarginFrom, type CalcState, type CalculatorContext, type RubroRow } from "@/components/budget/calculator-state";
import { line, project, usage } from "./helpers";

// Caso de la planilla del cliente: materiales 50.000; operarios 3 h × 19.000; diseño 1 h × 27.000; administración 2 h × 27.000.
const rubro = (patch: Partial<RubroRow> = {}): RubroRow => ({
  ...newRubroRow("carpinteria_madera"),
  materials: [{ key: "m", name: "Melamina", unit: "placa", quantity: "1", unitCost: "50000", wastePct: "0" }],
  workers: "1",
  hoursPerWorker: "3",
  designHours: "1",
  adminHours: "2",
  ...patch,
});
const state = (patch: Partial<CalcState> = {}, row: Partial<RubroRow> = {}): CalcState => ({ ...initialCalcState(5), rubros: [rubro(row)], ...patch });
const ctx: CalculatorContext = { projects: [], rates: DEFAULT_HOUR_RATES, overtimeMultiplier: 2, hoursPerDay: 9.5, salesPrice: 0, isDemo: false };
const calc = (s: CalcState, patch: Partial<typeof ctx> = {}) => computeCalculator(s, "Local comercial", { ...ctx, ...patch });

describe("desglose del resumen (panel, Resultado y Revisar y crear)", () => {
  it("caso del cliente: precio 282.707, costo 202.135, rentabilidad 28,5 %", () => {
    const b = calc(state()).breakdown;
    expect(b.materials).toEqual({ cost: 50_000, safetyMargin: 0, targetPct: 30, sale: expect.closeTo(71_428.57, 2) });
    expect(b.labor).toMatchObject({ cost: 138_000, operators: 57_000, design: 27_000, admin: 54_000, targetPct: 30 });
    expect(b.labor.sale).toBeCloseTo(197_142.86, 2);
    expect(b.financial.pct).toBe(5);
    expect(b.financial.amount).toBeCloseTo(14_135.35, 2);
    expect(b.price).toBe(282_707);
    expect(b.priceSource).toBe("suggested");
    expect(Math.round(b.totalCost)).toBe(202_135);
    expect(b.profit).toBeCloseTo(80_571.65, 2);
    expect(b.margin).toBeCloseTo(28.5, 1);
  });

  it("sin transporte ni imprevistos quedan en 0 (el panel los oculta)", () => {
    const b = calc(state({ rubros: [rubro(), { ...newRubroRow("transporte"), amount: "10000" }] })).breakdown;
    expect(b.transport).toBe(10_000);
    expect(b.contingency).toBe(0);
  });

  it("los valores cambian al editar materiales, horas, tarifas, rentabilidades y gasto financiero", () => {
    const base = calc(state()).breakdown;
    const changed = [
      calc(state({}, { materials: [{ key: "m", name: "Melamina", unit: "placa", quantity: "2", unitCost: "50000", wastePct: "0" }] })).breakdown,
      calc(state({}, { hoursPerWorker: "4" })).breakdown,
      calc(state({}, { designHours: "2" })).breakdown,
      calc(state(), { rates: DEFAULT_HOUR_RATES.map((r) => (r.category === "labor" ? { ...r, hourlyRate: 20_000 } : r)) }).breakdown,
      calc(state({ materialsTargetPct: "40" })).breakdown,
      calc(state({ laborTargetPct: "35" })).breakdown,
      calc(state({ financialPct: "8" })).breakdown,
    ];
    for (const b of changed) expect(b.price).not.toBe(base.price);
    expect(changed[1].labor.operators).toBe(76_000);
    expect(changed[3].labor.operators).toBe(60_000);
    expect(changed[4].materials.targetPct).toBe(40);
    expect(changed[6].financial.pct).toBe(8);
  });

  it("con un precio escrito a mano: costo, ganancia y rentabilidad salen de ese precio y no hay venta por tipo", () => {
    const b = calc(state(), { salesPrice: 300_000 }).breakdown;
    expect(b).toMatchObject({ price: 300_000, priceSource: "chosen", usesSuggested: false, suggestedPrice: 282_707 });
    expect(b.materials.sale).toBeNull();
    expect(b.financial.amount).toBe(15_000);
    expect(b.totalCost).toBe(203_000);
    expect(b.margin).toBeCloseTo(32.33, 2);
  });

  it("el mismo desglose se puede pedir directo a la función pura", () => {
    const c = calc(state());
    expect(quoteBreakdown(c.lines, c.input, 0)).toEqual(c.breakdown);
  });
});

describe("aprendizaje de proyectos anteriores", () => {
  const done = (budget: number, actual: number) =>
    project({
      status: "completed",
      budgetLines: [line("materials", null, budget)],
      materialUsages: [usage({ quantityConsumed: actual / 50_000, unitCost: 50_000 })],
    });
  const three = [done(100_000, 110_000), done(100_000, 112_000), done(100_000, 110_700)];

  it("dice el signo en palabras y la cantidad de proyectos", () => {
    const [i] = learningInsights(benchmarksForType(three, "Local comercial"), { isDemo: false });
    expect(i.category).toBe("materials");
    expect(i.avgOverrunPct).toBeCloseTo(10.9, 6);
    expect(i.text).toBe("En 3 proyectos parecidos, Materiales costó 10,9% más de lo presupuestado.");
    expect(i.weak).toBe(true); // menos de 10 comparables: indicio, no conclusión
  });

  it(`con menos de ${MIN_LEARNING_PROJECTS} proyectos no se muestra, salvo en la demo (rotulado e indicio)`, () => {
    const b = benchmarksForType(three.slice(0, 2), "Local comercial");
    expect(learningInsights(b, { isDemo: false })).toEqual([]);
    const demo = learningInsights(b, { isDemo: true });
    expect(demo).toHaveLength(1);
    expect(demo[0].weak).toBe(true);
    expect(demo[0].text).toMatch(/^En 2 proyectos parecidos/);
  });

  it("el resultado del cotizador trae las líneas de aprendizaje del tipo de proyecto", () => {
    expect(calc(state(), { projects: three }).insights).toHaveLength(1);
    expect(calc(state(), { projects: three.slice(0, 1) }).insights).toEqual([]);
  });
});

describe("margen de seguridad", () => {
  const insight = { category: "materials" as const, avgOverrunPct: 10.9333, sampleSize: 3, text: "", weak: false };

  it("arranca con el desvío promedio redondeado a un decimal", () => {
    expect(safetyMarginFrom(insight, "Local comercial")).toEqual({ category: "materials", pct: "10,9", referencePct: 10.9333, sampleSize: 3, projectType: "Local comercial" });
  });

  it("agrega una línea visible y trazable que sube el costo y el precio; se puede editar y quitar", () => {
    const sin = calc(state());
    const con = calc(state({ safetyMargins: [safetyMarginFrom(insight, "Local comercial")] }));
    const l = con.lines.find((x) => !x.rubro && x.category === "materials");
    expect(l).toMatchObject({ description: "Margen de seguridad materiales (+10,9%)", unitCost: 5_450 });
    expect(l?.notes).toContain('3 proyectos "Local comercial"');
    expect(con.breakdown.materials).toMatchObject({ cost: 55_450, safetyMargin: 5_450 });
    expect(con.breakdown.price).toBeGreaterThan(sin.breakdown.price);

    const editado = calc(state({ safetyMargins: [{ ...safetyMarginFrom(insight, "Local comercial"), pct: "20" }] }));
    expect(editado.breakdown.materials.safetyMargin).toBe(10_000);

    const quitado = calc(state({ safetyMargins: [] }));
    expect(quitado.breakdown).toEqual(sin.breakdown);
  });
});

describe("piso de rentabilidad del atraso", () => {
  it("vacío usa la rentabilidad total del precio sugerido; escrito, el valor cargado (también 0)", () => {
    expect(calc(state(), { salesPrice: 600_000 }).delay?.floorPct).toBeCloseTo(28.5, 1);
    expect(calc(state({ delayFloorPct: "0" }), { salesPrice: 600_000 }).delay?.floorPct).toBe(0);
    expect(calc(state({ delayFloorPct: "15,5" }), { salesPrice: 600_000 }).delay?.floorPct).toBe(15.5);
  });
});
