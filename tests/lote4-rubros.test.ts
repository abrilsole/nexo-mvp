// Lote 4 — mapeo de categorías, costos reales con las categorías nuevas y guardado de tarifas.
import { describe, expect, it } from "vitest";
import type { BudgetCategory } from "@/types";
import { ACTUAL_TYPE_TO_CATEGORY, actualEntryLabel, CATEGORY_ORDER, DEFAULT_SETTINGS, normalizeCategory } from "@/lib/constants";
import { costSettingsFromRow, hourRateFromRow, hourRateToRow } from "@/lib/supabase/mappers";
import { buildSeed } from "@/lib/seed-data";
import * as ops from "@/lib/project-operations";
import { project } from "./helpers";

describe("mapeo de las siete categorías anteriores a las seis nuevas", () => {
  const cases: Array<[string, string, BudgetCategory]> = [
    ["materials", "Melamina", "materials"],
    ["labor", "Horas", "labor"],
    ["machines", "Máquina: Seccionadora", "labor"],
    ["outsourcing", "Laqueado", "materials"],
    ["finishing", "Terminaciones", "materials"],
    ["logistics", "Flete", "transport"],
    ["installation", "Instalación en obra", "labor"],
    ["contingency", "Varios", "contingency"],
    ["other", "Máquina: CNC", "labor"],
    ["other", "Varios", "contingency"],
  ];
  it.each(cases)("%s (%s) → %s", (raw, description, expected) => {
    expect(normalizeCategory(raw, description)).toBe(expected);
  });
  it("las categorías nuevas quedan como están", () => {
    for (const c of CATEGORY_ORDER) expect(normalizeCategory(c)).toBe(c);
  });
});

describe("costos reales con las categorías nuevas", () => {
  const ctx: ops.Ctx = { actor: "Laura", now: "2026-01-10T10:00:00Z", role: "owner" };
  const p = project({ status: "production" });

  it("cada tipo de costo cae en su categoría; el uso de máquina ya no es un tipo aparte", () => {
    expect(ACTUAL_TYPE_TO_CATEGORY).toMatchObject({ outsourcing: "materials", installation: "labor", logistics: "transport", unexpected: "contingency" });
  });

  it("un gasto de administración o financiero se imputa en la categoría elegida", () => {
    const admin = ops.addActual(p, { type: "other", category: "admin", description: "Diseño de planos", amount: 100, date: "2026-01-09" }, DEFAULT_SETTINGS, ctx);
    expect(admin.actualEntries.at(-1)?.category).toBe("admin");
    const fin = ops.addActual(p, { type: "other", category: "financial", description: "Comisión bancaria", amount: 50, date: "2026-01-09" }, DEFAULT_SETTINGS, ctx);
    expect(fin.actualEntries.at(-1)?.category).toBe("financial");
  });

  it("un registro viejo de máquinas se sigue leyendo como tal", () => {
    expect(actualEntryLabel({ type: "other", category: "labor" })).toBe("Uso de máquinas (registro anterior)");
    expect(actualEntryLabel({ type: "other", category: "admin" })).toBe("Gasto de administración o financiero");
  });
});

describe("datos demo", () => {
  it("usan solo las categorías nuevas y cada línea de costo presupuestado tiene rubro", () => {
    for (const p of buildSeed(new Date("2026-10-13T12:00:00")).projects) {
      for (const l of p.budgetLines) {
        expect(CATEGORY_ORDER).toContain(l.category);
        expect(l.rubro, `${p.code} · ${l.description}`).toBeDefined();
      }
      for (const e of p.actualEntries) expect(CATEGORY_ORDER).toContain(e.category);
    }
  });
});

describe("tarifas y gasto financiero en la base", () => {
  it("tipo de hora: dominio → fila → dominio", () => {
    const rate = { id: "admin", name: "Administrativa / diseño", hourlyRate: 27_000, category: "admin" as const };
    const row = hourRateToRow("org", rate, 1);
    expect(row).toMatchObject({ organization_id: "org", id: "admin", hourly_rate: 27_000, category: "admin", position: 1 });
    expect(hourRateFromRow({ ...row, hourly_rate: "27000" })).toEqual(rate);
  });
  it("sin valores válidos se usan los de por defecto", () => {
    expect(costSettingsFromRow({ overtime_multiplier: "1.5", financial_pct: "4" })).toEqual({ overtimeMultiplier: 1.5, financialPct: 4 });
    expect(costSettingsFromRow({ overtime_multiplier: null, financial_pct: null })).toEqual({ overtimeMultiplier: 2, financialPct: 5 });
  });
});
