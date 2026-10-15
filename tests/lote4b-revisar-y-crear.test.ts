// Lote 4b — Diseño y Administración por separado, y el resumen del paso "Revisar y crear".
import { describe, expect, it } from "vitest";
import type { HourRate } from "@/types";
import { rubroTable } from "@/lib/budget-calculator";
import { DEFAULT_HOUR_RATES } from "@/lib/constants";
import { computeCalculator, initialCalcState, newRubroRow, ratesText, reviewWarnings, type CalcState, type RubroRow } from "@/components/budget/calculator-state";

const RATES: HourRate[] = DEFAULT_HOUR_RATES;

const madera = (patch: Partial<RubroRow> = {}): RubroRow => ({
  ...newRubroRow("carpinteria_madera"),
  materials: [{ key: "m1", name: "Melamina blanca 18 mm", unit: "placa", quantity: "10", unitCost: "50000", wastePct: "10" }],
  workers: "2",
  hoursPerWorker: "40",
  designHours: "6",
  adminHours: "4",
  ...patch,
});

const state = (rubros: RubroRow[], patch: Partial<CalcState> = {}): CalcState => ({
  ...initialCalcState(5),
  materialsTargetPct: "30",
  laborTargetPct: "40",
  rubros,
  ...patch,
});

const base = state([
  madera(),
  { ...newRubroRow("vidrios"), materials: [{ key: "v", name: "Vidrio templado", unit: "u", quantity: "1", unitCost: "480000", wastePct: "0" }], workers: "0" },
  { ...newRubroRow("transporte"), amount: "100000" },
  { ...newRubroRow("imprevistos"), amount: "50000" },
]);
const ctx = { projects: [], rates: RATES, overtimeMultiplier: 2, hoursPerDay: 8, salesPrice: 6_000_000, isDemo: false };
const calc = (s: CalcState, patch: Partial<typeof ctx> = {}) => computeCalculator(s, "Local comercial", { ...ctx, ...patch });

describe("tabla por rubro del paso Revisar y crear", () => {
  it("una fila por rubro con importe; las columnas se trazan a lo cargado", () => {
    const t = rubroTable(calc(base).lines);
    expect(t.rows.map((r) => r.rubro)).toEqual(["carpinteria_madera", "vidrios", "transporte", "imprevistos"]);
    expect(t.rows[0]).toEqual({
      rubro: "carpinteria_madera",
      materials: 550_000, // 11 placas × 50.000
      labor: 1_520_000, // 2 × 40 h × 19.000
      design: 162_000, // 6 h × 27.000
      admin: 108_000, // 4 h × 27.000
      amount: 0,
      total: 2_340_000,
    });
    expect(t.rows[2]).toMatchObject({ rubro: "transporte", amount: 100_000, total: 100_000 });
  });

  it("el gasto financiero va aparte y el total coincide exactamente con el costo presupuestado", () => {
    const c = calc(base);
    const t = rubroTable(c.lines);
    expect(t.financial).toBe(300_000); // 5% de 6.000.000
    expect(t.total).toBe(c.total);
    expect(t.rows.reduce((s, r) => s + r.total, 0) + t.financial).toBeCloseTo(c.total, 6);
  });

  it("los rubros sin importe no aparecen", () => {
    const t = rubroTable(calc(state([...base.rubros, newRubroRow("herrajes"), { ...newRubroRow("embalaje"), workers: "0" }])).lines);
    expect(t.rows.map((r) => r.rubro)).not.toContain("herrajes");
    expect(t.rows.map((r) => r.rubro)).not.toContain("embalaje");
  });

  it("el total cambia al cambiar horas, tarifas o gasto financiero, y siempre coincide con el costo", () => {
    const totalOf = (s: CalcState, patch: Partial<typeof ctx> = {}) => {
      const c = calc(s, patch);
      expect(rubroTable(c.lines).total).toBe(c.total);
      return c.total;
    };
    const t0 = totalOf(base);
    expect(totalOf(state([madera({ hoursPerWorker: "50" }), ...base.rubros.slice(1)]))).toBe(t0 + 2 * 10 * 19_000);
    expect(totalOf(state([madera({ designHours: "10" }), ...base.rubros.slice(1)]))).toBe(t0 + 4 * 27_000);
    expect(totalOf(base, { rates: RATES.map((r) => (r.id === "admin" ? { ...r, hourlyRate: 30_000 } : r)) })).toBe(t0 + 4 * 3_000);
    expect(totalOf(state(base.rubros, { financialPct: "8" }))).toBe(t0 + 0.03 * 6_000_000);
  });

  it("los ajustes por historial (sin rubro) aparecen en su propia fila", () => {
    const t = rubroTable([
      { category: "materials", rubro: "carpinteria_madera", description: "x", quantity: 1, unit: "u", unitCost: 1000 },
      { category: "materials", description: "Ajuste por historial (+8%)", quantity: null, unit: "global", unitCost: 80 },
    ]);
    expect(t.rows.map((r) => [r.rubro, r.total])).toEqual([
      ["carpinteria_madera", 1000],
      [undefined, 80],
    ]);
    expect(t.total).toBe(1080);
  });
});

describe("supuestos y avisos del paso Revisar y crear", () => {
  it("las tres tarifas usadas", () => {
    expect(ratesText(calc(base).rates)).toBe("Mano de obra $ 19.000/h · Diseño $ 27.000/h · Administración $ 27.000/h");
  });

  it("sin avisos cuando el precio es el sugerido y la fecha entra", () => {
    const longPlazo = { ...base, deadlineDays: "20" };
    const c0 = calc(longPlazo);
    const c = calc(longPlazo, { salesPrice: c0.breakdown.suggestedPrice! });
    expect(reviewWarnings(c, c0.breakdown.suggestedPrice!)).toEqual([]);
  });

  it("todos los avisos juntos: fecha que no entra con horas extra, precio a mano y precio faltante", () => {
    const short = calc({ ...base, deadlineDays: "3" });
    const w = reviewWarnings(short, 6_000_000);
    expect(w.some((x) => /no entran en el plazo/.test(x) && /horas extra/.test(x))).toBe(true);
    expect(w.some((x) => /escrito a mano/.test(x))).toBe(true);
    expect(reviewWarnings(calc(base, { salesPrice: 0 }), 0)).toContain("Falta el precio de venta.");
  });

  it("avisa si falta una tarifa", () => {
    const c = calc(base, { rates: RATES.filter((r) => r.id !== "design") });
    expect(reviewWarnings(c, 6_000_000).some((x) => /Falta la tarifa/.test(x))).toBe(true);
  });
});
