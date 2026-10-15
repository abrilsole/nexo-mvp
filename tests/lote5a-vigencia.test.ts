// Lote 5A — precios con vigencia: el pasado no se modifica nunca.
import { describe, expect, it } from "vitest";
import type { PriceRecord } from "@/types";
import { BEFORE_HISTORY, hourRatesAt, laborCostAt, operatorsAt, priceChange, priceChangeError, priceTimeline, rateAt, recordAt, valueAt } from "@/lib/price-history";
import { DEFAULT_HOUR_RATES } from "@/lib/constants";
import { applyCorrection, correctionError, isFrozen } from "@/lib/corrections";
import { buildSeed } from "@/lib/seed-data";

const rec = (value: number, validFrom: string, createdAt = "2026-01-01T10:00:00Z", extra: Partial<PriceRecord> = {}): PriceRecord => ({
  id: `ph-${value}-${validFrom}-${createdAt}`,
  kind: "operator_cost",
  subjectId: "op-juan",
  value,
  validFrom,
  createdAt,
  createdBy: "Laura",
  ...extra,
});

describe("rateAt: valor vigente en una fecha", () => {
  // Cambio de 10.000 a 15.000 a mitad de mes.
  const history = [rec(10_000, "2026-03-01"), rec(15_000, "2026-03-16")];

  it("lo anterior al cambio sigue con 10.000; desde el cambio, 15.000", () => {
    expect(rateAt(history, "2026-03-10")).toBe(10_000);
    expect(rateAt(history, "2026-03-15")).toBe(10_000);
    expect(rateAt(history, "2026-03-16")).toBe(15_000);
    expect(rateAt(history, "2026-04-30")).toBe(15_000);
  });
  it("el orden en que llegan los registros no importa", () => {
    expect(rateAt([...history].reverse(), "2026-03-10")).toBe(10_000);
  });
  it("antes del primer registro vale el primero; sin historial, null", () => {
    expect(rateAt(history, "2025-12-31")).toBe(10_000);
    expect(rateAt([], "2026-03-10")).toBeNull();
  });
  it("dos cambios el mismo día: vale el último cargado", () => {
    const same = [rec(12_000, "2026-03-16", "2026-03-16T09:00:00Z"), rec(13_000, "2026-03-16", "2026-03-16T11:00:00Z")];
    expect(rateAt(same, "2026-03-20")).toBe(13_000);
  });
  it("valueAt usa el valor cargado de siempre cuando no hay historial", () => {
    expect(valueAt(history, "operator_cost", "op-juan", "2026-03-20", 1)).toBe(15_000);
    expect(valueAt(history, "operator_cost", "op-otro", "2026-03-20", 9_000)).toBe(9_000);
    expect(valueAt(history, "hour_rate", "op-juan", "2026-03-20", 19_000)).toBe(19_000);
  });
});

describe("un cambio agrega registros, nunca modifica uno anterior", () => {
  const base = { kind: "operator_cost" as const, subjectId: "op-juan", createdBy: "Laura", now: "2026-03-16T10:00:00Z" };

  it("el primer cambio guarda también el valor anterior desde siempre: lo pasado no cambia", () => {
    const added = priceChange([], { ...base, value: 15_000, validFrom: "2026-03-16", previousValue: 10_000 });
    expect(added.map((r) => [r.value, r.validFrom])).toEqual([
      [10_000, BEFORE_HISTORY],
      [15_000, "2026-03-16"],
    ]);
    expect(rateAt(added, "2026-03-10")).toBe(10_000);
    expect(rateAt(added, "2026-03-16")).toBe(15_000);
  });
  it("con historial, solo se agrega el nuevo", () => {
    const history = [rec(10_000, "2026-03-01")];
    const added = priceChange(history, { ...base, value: 15_000, validFrom: "2026-03-16", previousValue: 10_000 });
    expect(added).toHaveLength(1);
    const all = [...history, ...added];
    expect(rateAt(all, "2026-03-15")).toBe(10_000);
    expect(history).toEqual([rec(10_000, "2026-03-01")]);
  });
  it("con fecha futura, hoy sigue el valor de hoy", () => {
    const all = priceChange([], { ...base, value: 20_000, validFrom: "2026-05-01", previousValue: 15_000 });
    expect(rateAt(all, "2026-03-16")).toBe(15_000);
    expect(rateAt(all, "2026-05-01")).toBe(20_000);
  });
  it("si el valor no cambia en esa fecha, no se agrega nada", () => {
    expect(priceChange([], { ...base, value: 10_000, validFrom: "2026-03-16", previousValue: 10_000 })).toEqual([]);
    expect(priceChange([rec(15_000, "2026-03-01")], { ...base, value: 15_000, validFrom: "2026-04-01", previousValue: 1 })).toEqual([]);
  });
  it("valida valor y fecha", () => {
    expect(priceChangeError({ value: 0, validFrom: "2026-03-16" })).toMatch(/mayor a cero/);
    expect(priceChangeError({ value: 1, validFrom: "16/03/2026" })).toMatch(/fecha/);
    expect(() => priceChange([], { ...base, value: -1, validFrom: "2026-03-16", previousValue: 1 })).toThrow(/mayor a cero/);
  });
});

describe("historial para mostrar", () => {
  it("más nuevo primero, con el vigente hoy y los programados", () => {
    const t = priceTimeline([rec(10_000, "2026-01-01"), rec(15_000, "2026-03-16"), rec(20_000, "2026-06-01")], "2026-04-01");
    expect(t.map((r) => [r.value, r.status])).toEqual([
      [20_000, "scheduled"],
      [15_000, "current"],
      [10_000, "previous"],
    ]);
  });
  it("recordAt devuelve el registro (quién y cuándo lo cargó)", () => {
    expect(recordAt([rec(10_000, "2026-01-01")], "2026-02-01")?.createdBy).toBe("Laura");
  });
});

describe("valores vigentes para el resto de la app", () => {
  const history: PriceRecord[] = [
    rec(19_000, BEFORE_HISTORY, undefined, { kind: "hour_rate", subjectId: "labor" }),
    rec(21_000, "2026-03-16", undefined, { kind: "hour_rate", subjectId: "labor" }),
    rec(15_000, "2026-03-16"),
  ];
  it("tarifas y costos por hora vigentes en una fecha", () => {
    expect(hourRatesAt(DEFAULT_HOUR_RATES, history, "2026-03-10").find((r) => r.id === "labor")?.hourlyRate).toBe(19_000);
    expect(hourRatesAt(DEFAULT_HOUR_RATES, history, "2026-03-20").find((r) => r.id === "labor")?.hourlyRate).toBe(21_000);
    expect(hourRatesAt(DEFAULT_HOUR_RATES, history, "2026-03-20").find((r) => r.id === "design")?.hourlyRate).toBe(27_000);
    const ops = [{ id: "op-juan", name: "Juan", role: "x", hourlyCost: 10_000, active: true, createdAt: "" }];
    expect(operatorsAt(ops, history, "2026-03-20")[0].hourlyCost).toBe(15_000);
  });
  it("horas reales: con el costo del operario o con la tarifa general (hipótesis a confirmar), vigentes ese día", () => {
    const operator = { id: "op-juan", hourlyCost: 10_000 };
    expect(laborCostAt({ valuation: "operator", operator, laborRate: 19_000, history, date: "2026-03-20" })).toBe(15_000);
    expect(laborCostAt({ valuation: "operator", operator: { id: "op-nuevo", hourlyCost: 9_000 }, laborRate: 19_000, history, date: "2026-03-20" })).toBe(9_000);
    expect(laborCostAt({ valuation: "general", operator, laborRate: 19_000, history, date: "2026-03-10" })).toBe(19_000);
    expect(laborCostAt({ valuation: "general", operator, laborRate: 19_000, history, date: "2026-03-20" })).toBe(21_000);
  });
});

describe("valores congelados y correcciones", () => {
  const seedProjects = () => buildSeed(new Date("2026-10-13T12:00:00")).projects;
  const receipt = { id: "cor-1", correctedAt: "2026-10-15T12:00:00.000Z", correctedBy: "Laura Gómez", oldValue: 100, description: "Precio de venta", activityId: "act-cor-1", message: "Corrección de precio de venta: 100 → 120. Motivo: Descuento" };

  it("desde Aprobado (y cerrado) el precio y el costo presupuestado están congelados; en Cotización no", () => {
    const ps = seedProjects();
    expect(isFrozen(ps.find((p) => p.status === "quotation")!)).toBe(false);
    expect(isFrozen(ps.find((p) => p.status === "approved")!)).toBe(true);
    expect(isFrozen(ps.find((p) => p.isClosed)!)).toBe(true);
  });
  it("la corrección pide motivo y un valor válido", () => {
    const approved = seedProjects().find((p) => p.status === "approved")!;
    const quotation = seedProjects().find((p) => p.status === "quotation")!;
    const price = { target: "sales_price" as const, field: "sales_price" as const, newValue: 120, reason: "Descuento" };
    expect(correctionError(approved, price)).toBeNull();
    expect(correctionError(approved, { ...price, reason: " " })).toMatch(/motivo/);
    expect(correctionError(approved, { ...price, newValue: 0 })).toMatch(/mayor a cero/);
    expect(correctionError(quotation, price)).toMatch(/Cotización/);
    expect(correctionError(approved, { target: "budget_line", field: "unit_cost", lineId: "no-existe", newValue: 1, reason: "Error" })).toMatch(/no encontrada/);
  });
  it("se refleja igual que en la base: nuevo valor, total recalculado y el evento de Actividad", () => {
    const approved = seedProjects().find((p) => p.status === "approved")!;
    const line = approved.budgetLines.find((l) => l.quantity !== null)!;
    const res = applyCorrection(approved, { target: "budget_line", field: "unit_cost", lineId: line.id, newValue: 1_000, reason: "Error de tipeo" }, { ...receipt, description: line.description });
    const after = res.project.budgetLines.find((l) => l.id === line.id)!;
    expect(after.unitCost).toBe(1_000);
    expect(after.total).toBe(Math.round(line.quantity! * 1_000 * 100) / 100);
    expect(res.project.activity.at(-1)).toMatchObject({ id: "act-cor-1", actor: "Laura Gómez" });
    expect(res.correction).toMatchObject({ oldValue: 100, newValue: 1_000, reason: "Error de tipeo", correctedBy: "Laura Gómez" });
    expect(approved.budgetLines.find((l) => l.id === line.id)!.unitCost).toBe(line.unitCost); // no muta el original
    const priced = applyCorrection(approved, { target: "sales_price", field: "sales_price", newValue: 120, reason: "Descuento" }, receipt);
    expect(priced.project.salesPrice).toBe(120);
  });
});
