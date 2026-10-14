// Lote 4c — atraso, jornada de Configuración congelada en la cotización, plazo en días hábiles y textos.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { delayAnalysis, scenarioDays, type DelayInput } from "@/lib/delay";
import { costSettingsError, hourRatesError } from "@/lib/cost-settings";
import { DEFAULT_HOUR_RATES, DEFAULT_HOURS_PER_DAY } from "@/lib/constants";
import { computeCalculator, initialCalcState, newRubroRow, quoteActionBlocker, type CalcState } from "@/components/budget/calculator-state";

describe("si el trabajo se alarga", () => {
  const known: DelayInput = { price: 1_000_000, cost: 700_000, workers: 2, hoursPerDay: 9.5, laborRate: 19_000, dailyPenalty: 0, floorPct: 30, workDays: 8 };
  const cheap = { workers: 1, hoursPerDay: 1, laborRate: 10_000 }; // 10.000 por día

  it("caso conocido: c_dia = 361.000, R(0) = 30,0 %, un día extra deja −6,1 %, d_cero ≈ 0,83 días", () => {
    const d = delayAnalysis({ ...known, workDays: 1 })!;
    expect(d.dailyCost).toBe(361_000);
    expect(d.scenarios[0].margin).toBeCloseTo(30, 6);
    expect(d.scenarios[1]).toMatchObject({ pct: 25, days: 1 });
    expect(d.scenarios[1].margin).toBeCloseTo(-6.1, 6);
    expect(d.pointsPerDay).toBeCloseTo(36.1, 6);
    expect(d.daysToFloor).toBe(0);
    expect(d.daysToZero).toBeCloseTo(0.83, 2);
  });

  it("escenarios proporcionales: +25 %, +50 % y +100 % de los días de trabajo estimados, redondeando hacia arriba", () => {
    const d = delayAnalysis({ ...known, ...cheap, workDays: 10 })!;
    expect(d.scenarios.map((s) => [s.pct, s.days])).toEqual([
      [0, 0],
      [25, 3], // 2,5 → 3
      [50, 5],
      [100, 10],
    ]);
    expect(d.scenarios[1]).toEqual({ pct: 25, days: 3, cost: 730_000, profit: 270_000, margin: 27 });
  });

  it("cada escenario tiene como mínimo 1 día", () => {
    expect(scenarioDays(2, 25)).toBe(1);
    expect(scenarioDays(0, 50)).toBe(1);
    expect(scenarioDays(3, 50)).toBe(2);
    expect(scenarioDays(23, 100)).toBe(23);
    const d = delayAnalysis({ ...known, ...cheap, workDays: 2 })!;
    expect(d.scenarios.map((s) => s.days)).toEqual([0, 1, 1, 2]);
  });

  it("días hasta el piso con decimales: (P − C − r_min × P) / c_dia", () => {
    expect(delayAnalysis({ ...known, ...cheap, floorPct: 20 })!.daysToFloor).toBe(10);
    expect(delayAnalysis({ ...known, workers: 1, hoursPerDay: 1, laborRate: 30_000, floorPct: 20 })!.daysToFloor).toBeCloseTo(3.33, 2);
    expect(delayAnalysis({ ...known, price: 2_000_000, floorPct: 30 })!.daysToFloor).toBeCloseTo(1.94, 2);
    expect(delayAnalysis({ ...known, floorPct: 40 })!.daysToFloor).toBe(0); // ya está por debajo
  });

  it("sin costo por día no divide por cero", () => {
    const d = delayAnalysis({ ...known, workers: 0, dailyPenalty: 0 })!;
    expect(d.dailyCost).toBe(0);
    expect(d.daysToFloor).toBeNull();
    expect(d.daysToZero).toBeNull();
  });

  it("cambia al cambiar operarios, jornada, tarifa, multa, precio, piso y días estimados", () => {
    const base = delayAnalysis(known)!;
    expect(delayAnalysis({ ...known, workers: 3 })!.dailyCost).toBe(541_500);
    expect(delayAnalysis({ ...known, hoursPerDay: 8 })!.dailyCost).toBe(304_000);
    expect(delayAnalysis({ ...known, laborRate: 20_000 })!.dailyCost).toBe(380_000);
    expect(delayAnalysis({ ...known, dailyPenalty: 50_000 })!.dailyCost).toBe(411_000);
    expect(delayAnalysis({ ...known, price: 2_000_000 })!.pointsPerDay).toBeCloseTo(base.pointsPerDay / 2, 6);
    expect(delayAnalysis({ ...known, price: 2_000_000, floorPct: 10 })!.daysToFloor).toBeCloseTo(3.05, 2);
    expect(delayAnalysis({ ...known, workDays: 20 })!.scenarios.map((s) => s.days)).toEqual([0, 5, 10, 20]);
  });

  it("sin precio o sin costo no se calcula", () => {
    expect(delayAnalysis({ ...known, price: 0 })).toBeNull();
    expect(delayAnalysis({ ...known, cost: 0 })).toBeNull();
  });
});

describe("jornada de Configuración y plazo en días hábiles", () => {
  const state = (patch: Partial<CalcState> = {}): CalcState => ({
    ...initialCalcState(5),
    rubros: [{ ...newRubroRow("carpinteria_madera"), materials: [], workers: "2", hoursPerWorker: "38" }],
    ...patch,
  });
  const ctx = { projects: [], rates: DEFAULT_HOUR_RATES, overtimeMultiplier: 2, hoursPerDay: DEFAULT_HOURS_PER_DAY, salesPrice: 0, isDemo: false };

  it("la jornada por defecto es 9,5 h y sale de Configuración", () => {
    const c = computeCalculator(state(), "", ctx);
    expect(c.input.hoursPerDay).toBe(9.5);
    expect(c.schedule.workDays).toBe(4); // 38 h / 9,5 h
    expect(computeCalculator(state(), "", { ...ctx, hoursPerDay: 8 }).schedule.workDays).toBe(5); // 4,75 → 5
  });

  it("la jornada usada queda congelada en cada línea de horas, junto con la tarifa", () => {
    const lines = computeCalculator(state({ deadlineDays: "2" }), "", ctx).lines.filter((l) => l.category === "labor");
    expect(lines.map((l) => [l.hourType, l.hoursPerDay, l.unitCost])).toEqual([
      ["normal", 9.5, 19_000],
      ["overtime", 9.5, 38_000],
    ]);
  });

  it("sin plazo no hay horas extra; con plazo corto, las horas que no entran son horas extra", () => {
    expect(computeCalculator(state(), "", ctx).overtimeHours).toBe(0);
    const short = computeCalculator(state({ deadlineDays: "2" }), "", ctx); // 4 días de trabajo, plazo 2
    expect(short.schedule).toMatchObject({ availableDays: 2, fits: false });
    expect(short.overtimeHours).toBe(38); // la mitad de 2 × 38 h
    expect(computeCalculator(state({ deadlineDays: "4" }), "", ctx).schedule.fits).toBe(true);
  });

  it("el atraso usa la jornada, el equipo más grande y la tarifa de mano de obra", () => {
    const c = computeCalculator(state(), "", { ...ctx, salesPrice: 2_000_000 });
    expect(c.crewSize).toBe(2);
    expect(c.delay?.dailyCost).toBe(2 * 9.5 * 19_000);
    expect(computeCalculator(state({ delayPenalty: "10000" }), "", { ...ctx, salesPrice: 2_000_000 }).delay?.dailyCost).toBe(2 * 9.5 * 19_000 + 10_000);
    expect(computeCalculator(state({ delayFloorPct: "12" }), "", { ...ctx, salesPrice: 2_000_000 }).delay?.floorPct).toBe(12);
  });

  it("valida la jornada entre 1 y 24 horas, y las tarifas mayores a cero", () => {
    const ok = { overtimeMultiplier: 2, financialPct: 5, hoursPerDay: 9.5 };
    expect(costSettingsError(ok)).toBeNull();
    expect(costSettingsError({ ...ok, hoursPerDay: 0.5 })).toMatch(/jornada/);
    expect(costSettingsError({ ...ok, hoursPerDay: 25 })).toMatch(/jornada/);
    expect(hourRatesError(DEFAULT_HOUR_RATES)).toBeNull();
    expect(hourRatesError([{ ...DEFAULT_HOUR_RATES[1], hourlyRate: 0 }])).toMatch(/Diseño/);
  });

  it("el botón final explica por qué está deshabilitado", () => {
    const empty = computeCalculator({ ...initialCalcState(5), rubros: [] }, "", ctx);
    expect(quoteActionBlocker(empty, 0)).toBe("Cargá al menos un costo.");
    const withCost = computeCalculator(state(), "", ctx);
    expect(quoteActionBlocker(withCost, 0)).toMatch(/precio de venta/);
    expect(quoteActionBlocker(withCost, 1_000_000)).toBeNull();
  });
});

describe("textos", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
    });

  it("no hay \"Rentab.\" abreviado en la app", () => {
    const root = path.resolve(import.meta.dirname, "..");
    for (const f of [...files(path.join(root, "components")), ...files(path.join(root, "lib"))]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/rentab\./i);
    }
  });
});
