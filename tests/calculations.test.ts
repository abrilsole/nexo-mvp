import { describe, expect, it } from "vitest";
import {
  aggregateMargins, budgetTotal, categoryVariance, expectedMargin, finalMargin, marginDeltaPoints,
  materialActualCost, projectedFinalCost, projectedMargin, projectEconomics, usageConsumedCost,
  usageProjectCost, usageWasteCost, usageLeftoverValue, budgetLineTotal, mainDeviation,
} from "@/lib/calculations";
import { line, project, usage } from "./helpers";

describe("presupuesto y margen esperado", () => {
  it("budgetLineTotal usa cantidad × costo o monto directo", () => {
    expect(budgetLineTotal({ quantity: 10, unitCost: 50000 })).toBe(500000);
    expect(budgetLineTotal({ quantity: null, unitCost: 300000 })).toBe(300000);
  });
  it("expectedMargin = (venta − presupuesto) / venta", () => {
    const lines = [line("materials", 10, 400000), line("labor", null, 3200000)];
    expect(budgetTotal(lines)).toBe(7200000);
    expect(expectedMargin(12000000, lines)).toBeCloseTo(40);
  });
  it("salesPrice = 0 devuelve null (sin división por cero)", () => {
    expect(expectedMargin(0, [line("labor", null, 100)])).toBeNull();
    expect(projectedMargin(project({ salesPrice: 0 }))).toBeNull();
  });
});

describe("costos de material", () => {
  const u = usage({ quantityConsumed: 9, wasteQuantity: 1, reusableLeftoverQuantity: 2, unitCost: 50000 });
  it("consumo, desperdicio y sobrante se valorizan por separado", () => {
    expect(usageConsumedCost(u)).toBe(450000);
    expect(usageWasteCost(u)).toBe(50000);
    expect(usageLeftoverValue(u)).toBe(100000);
  });
  it("costo imputable = consumo + desperdicio (el sobrante NO se imputa)", () => {
    expect(usageProjectCost(u)).toBe(500000);
    expect(materialActualCost([u])).toBe(500000);
  });
  it("sin registros de uso el costo material es 0 aunque haya compras", () => {
    const p = project({
      purchaseEntries: [{ id: "c", projectId: "p", materialName: "M", quantity: 12, unit: "placa", unitCost: 50000, total: 600000, date: "2026-01-02", createdBy: "t", createdAt: "x" }],
    });
    expect(materialActualCost(p.materialUsages)).toBe(0);
    expect(projectEconomics(p).actualCostToDate).toBe(0);
  });
});

describe("desvíos", () => {
  it("categoryVariance: actual > budget y actual < budget", () => {
    expect(categoryVariance(1200, 1000)).toEqual({ amount: 200, percent: 20 });
    expect(categoryVariance(800, 1000)).toEqual({ amount: -200, percent: -20 });
  });
  it("budget = 0 → percent null", () => {
    expect(categoryVariance(500, 0)).toEqual({ amount: 500, percent: null });
  });
});

describe("margen proyectado", () => {
  const lines = [line("materials", null, 400), line("labor", null, 200), line("transport", null, 100)];
  it("sin registros reales: proyectado = presupuesto", () => {
    const p = project({ budgetLines: lines });
    expect(projectedFinalCost(p)).toBe(700);
    expect(projectedMargin(p)).toBeCloseTo(30);
  });
  it("por categoría toma max(presupuesto, real)", () => {
    const p = project({
      budgetLines: lines,
      materialUsages: [usage({ quantityConsumed: 5, unitCost: 100 })], // 500 > 400
      actualEntries: [{ id: "a", projectId: "p", date: "2026-01-02", type: "labor", category: "labor", description: "x", amount: 50, createdBy: "t", createdAt: "x" }], // 50 < 200
    });
    expect(projectedFinalCost(p)).toBe(500 + 200 + 100);
    expect(projectedMargin(p)).toBeCloseTo(20);
    expect(marginDeltaPoints(30, 20)).toBe(-10);
    expect(mainDeviation(projectEconomics(p).categories)?.category).toBe("materials");
  });
  it("costo no presupuestado entra al proyectado", () => {
    const p = project({ budgetLines: lines, actualEntries: [{ id: "a", projectId: "p", date: "2026-01-02", type: "other", category: "admin", description: "x", amount: 100, createdBy: "t", createdAt: "x" }] });
    expect(projectedFinalCost(p)).toBe(800);
  });
});

describe("margen real final", () => {
  it("solo existe en proyectos finalizados y usa el real (no el max)", () => {
    const lines = [line("materials", null, 400), line("labor", null, 200)];
    const usages = [usage({ quantityConsumed: 3, unitCost: 100 })];
    const open = project({ budgetLines: lines, materialUsages: usages });
    expect(finalMargin(open)).toBeNull();
    const done = project({ budgetLines: lines, materialUsages: usages, status: "completed", isClosed: true });
    expect(finalMargin(done)).toBeCloseTo(70); // 1000 − 300
    const e = projectEconomics(done);
    expect(e.finalActualCost).toBe(300);
    expect(e.currentMargin).toBeCloseTo(70);
  });
});

describe("margen agregado", () => {
  it("es ponderado por venta, no promedio simple", () => {
    const a = project({ id: "a", salesPrice: 1000, budgetLines: [line("labor", null, 500)] }); // 50%
    const b = project({ id: "b", salesPrice: 9000, budgetLines: [line("labor", null, 8100)] }); // 10%
    const agg = aggregateMargins([a, b]);
    expect(agg.expectedAggregateMargin).toBeCloseTo(14); // (10000−8600)/10000, no 30
  });
});
