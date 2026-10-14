// Lote 1 — marca y mensajes honestos: reglas que las pantallas no recalculan por su cuenta.
import { describe, expect, it } from "vitest";
import type { Alert, Project } from "@/types";
import { projectEconomics } from "@/lib/calculations";
import { openAlertCount, projectAlerts, projectHealth, splitAlerts, allAlerts } from "@/lib/alerts";
import { remainingBudgetText } from "@/lib/insights";
import { activityTimeline } from "@/lib/activity";
import { delayAnalysis } from "@/lib/delay";
import { APP_NAME, CATEGORY_LABELS, CATEGORY_ORDER, DEFAULT_SETTINGS as S } from "@/lib/constants";
import { formatDays, formatMarginPoints, formatWorkingDays } from "@/lib/formatting";
import { buildSeed } from "@/lib/seed-data";
import { line, project, usage } from "./helpers";

const TODAY = "2026-01-11";

function alert(projectId: string, level: Alert["level"], id = `${projectId}:${level}`): Alert {
  return { id, projectId, projectCode: "P", projectName: "P", kind: "category", level, title: "t", message: "m", resolutionKey: `${id}~k` };
}

describe("marca", () => {
  it("el nombre sale de una sola constante", () => {
    expect(APP_NAME).toBe("Blerp");
  });
});

describe("la tabla de desvío suma exacto a la Diferencia", () => {
  it("desvíos positivos y negativos por categoría; el total es la Diferencia (finalizado)", () => {
    const p = project({
      status: "completed",
      isClosed: true,
      salesPrice: 10_000,
      budgetLines: [line("materials", null, 4_000), line("labor", null, 2_000), line("transport", null, 500)],
      materialUsages: [usage({ quantityConsumed: 1, unitCost: 4_513.5 })],
      actualEntries: [
        { id: "a1", projectId: "p", date: "2026-01-05", type: "labor", category: "labor", description: "h", amount: 1_700, createdBy: "t", createdAt: "x" },
        { id: "a2", projectId: "p", date: "2026-01-06", type: "other", category: "admin", description: "Diseño de planos", amount: 300, createdBy: "t", createdAt: "x" },
      ],
    });
    const econ = projectEconomics(p);
    const rows = econ.categories.filter((c) => c.projectedVariance.amount !== 0);
    expect(rows.map((x) => x.category).sort()).toEqual(["admin", "labor", "materials", "transport"]);
    expect(rows.some((x) => x.projectedVariance.amount < 0)).toBe(true);
    const sum = econ.categories.reduce((s, x) => s + x.projectedVariance.amount, 0);
    expect(sum).toBeCloseTo(econ.costOverrun, 6);
    expect(econ.costOverrun).toBeCloseTo(econ.projectedFinalCost - econ.budgetTotal, 6);
  });
  it("en el seed real, cada proyecto cierra exacto", () => {
    for (const p of buildSeed(new Date("2026-10-07T12:00:00")).projects) {
      const econ = projectEconomics(p);
      expect(econ.categories.reduce((s, x) => s + x.projectedVariance.amount, 0)).toBeCloseTo(econ.costOverrun, 6);
    }
  });
});

describe("salud del proyecto según alertas abiertas", () => {
  const withData = project({ materialUsages: [usage({ quantityConsumed: 1, unitCost: 10 })] });
  it("al menos una Crítica → En riesgo", () => {
    expect(projectHealth(withData, [alert("p", "warning"), alert("p", "critical")])).toBe("risk");
  });
  it("solo Atención → Atención", () => {
    expect(projectHealth(withData, [alert("p", "warning"), alert("p", "info")])).toBe("attention");
  });
  it("hay datos y no hay alertas → Sin desvíos", () => {
    expect(projectHealth(withData, [])).toBe("healthy");
    expect(projectHealth(withData, [alert("otro", "critical")])).toBe("healthy");
  });
  it("sin consumos ni costos → Sin datos todavía", () => {
    expect(projectHealth(project(), [])).toBe("no_data");
  });
  it("una alerta resuelta no cuenta para la salud", () => {
    const a = alert("p", "critical");
    const { open } = splitAlerts([a], [a.resolutionKey]);
    expect(projectHealth(withData, open)).toBe("healthy");
  });
});

describe("Cotización sin registros", () => {
  const q = project({ status: "quotation", budgetLines: [line("materials", null, 600)], salesPrice: 1000 });
  it("chip gris Sin datos todavía, sin alertas", () => {
    expect(projectAlerts(q, S, TODAY)).toHaveLength(0);
    expect(projectHealth(q, [])).toBe("no_data");
    expect(projectEconomics(q).hasExecutionData).toBe(false);
  });
  it("solo muestra lo que queda por gastar del costo presupuestado", () => {
    expect(remainingBudgetText(q)).toMatch(/^Quedan \$ 600 del costo presupuestado por gastar \(Materiales\)/);
  });
});

describe("Proyecto Finalizado", () => {
  const done: Project = project({
    status: "completed",
    isClosed: true,
    dueDate: "2025-01-01",
    salesPrice: 1000,
    budgetLines: [line("materials", null, 400)],
    materialUsages: [usage({ quantityConsumed: 1, unitCost: 900 })],
  });
  it("sin chip de salud ni alertas", () => {
    expect(projectAlerts(done, S, TODAY)).toHaveLength(0);
    expect(projectHealth(done, [alert("p", "critical")])).toBeNull();
  });
  it("no muestra lo que queda por gastar y el costo real final es el registrado", () => {
    expect(remainingBudgetText(done)).toBeNull();
    const econ = projectEconomics(done);
    expect(econ.finalActualCost).toBe(900);
  });
});

describe("globo de alertas = pestaña Todas", () => {
  it("salen de la misma cuenta de alertas abiertas", () => {
    const { projects, stock } = buildSeed(new Date("2026-10-07T12:00:00"));
    const all = allAlerts(projects, S, "2026-10-07", stock);
    const resolvedKeys = [all[0].resolutionKey];
    const { open, resolved } = splitAlerts(all, resolvedKeys);
    expect(openAlertCount(open)).toBe(open.length);
    expect(openAlertCount(open) + resolved.length).toBe(all.length);
    expect(resolved).toHaveLength(1);
  });
  it("si el problema persiste después de un nuevo registro, la alerta reaparece", () => {
    const p = project({ salesPrice: 2000, budgetLines: [line("materials", null, 1000)], materialUsages: [usage({ quantityConsumed: 1, unitCost: 1300, date: "2026-01-10" })] });
    const [a] = projectAlerts(p, S, TODAY).filter((x) => x.kind === "category");
    expect(splitAlerts(projectAlerts(p, S, TODAY), [a.resolutionKey]).open.some((x) => x.id === a.id)).toBe(false);
    const touched = { ...p, updatedAt: "2026-01-11T09:00:00Z" };
    expect(splitAlerts(projectAlerts(touched, S, TODAY), [a.resolutionKey]).open.some((x) => x.id === a.id)).toBe(true);
    expect(splitAlerts(projectAlerts(p, S, "2026-01-12"), [a.resolutionKey]).open.some((x) => x.id === a.id)).toBe(true);
  });
});

describe("sin precio de venta", () => {
  it("ganancia y margen son null (se muestran como —), nunca un negativo", () => {
    const econ = projectEconomics(project({ salesPrice: 0, budgetLines: [line("materials", null, 500)] }));
    expect(econ.hasSalesPrice).toBe(false);
    expect(econ.expectedProfit).toBeNull();
    expect(econ.projectedProfit).toBeNull();
    expect(econ.expectedMargin).toBeNull();
  });
  it("el cálculo de atraso necesita precio de venta y costo", () => {
    const base = { workers: 2, hoursPerDay: 9.5, laborRate: 19_000, dailyPenalty: 0, floorPct: 30 };
    expect(delayAnalysis({ ...base, price: 0, cost: 1000 })).toBeNull();
    expect(delayAnalysis({ ...base, price: 5000, cost: 0 })).toBeNull();
    expect(delayAnalysis({ ...base, price: 5000, cost: 1000 })).not.toBeNull();
  });
});

describe("categorías de reporte (Lote 4)", () => {
  it("son siempre las mismas siete, también en la tabla de desvío", () => {
    expect(CATEGORY_ORDER.map((c) => CATEGORY_LABELS[c])).toEqual([
      "Materiales", "Mano de obra", "Diseño", "Administración", "Transporte y fletes", "Gasto financiero", "Imprevistos",
    ]);
    expect(projectEconomics(project()).categories.map((c) => c.category)).toEqual(CATEGORY_ORDER);
  });
});

describe("textos", () => {
  it("días y puntos de rentabilidad bien escritos, sin pp", () => {
    expect(formatDays(1)).toBe("1 día");
    expect(formatWorkingDays(1)).toBe("1 día laboral");
    expect(formatWorkingDays(12)).toBe("12 días laborales");
    expect(formatMarginPoints(-9.2, { signed: true })).toBe("−9,2 puntos de rentabilidad");
    expect(formatMarginPoints(9.2, { short: true })).toBe("9,2 puntos");
    expect(formatMarginPoints(-9.2, { signed: true })).not.toMatch(/pp/);
  });
});

describe("actividad", () => {
  it("ninguna fecha posterior a hoy y en orden", () => {
    const now = new Date("2026-10-07T12:00:00");
    for (const p of buildSeed(now).projects) {
      const t = activityTimeline(p.activity, now.toISOString());
      expect(t.every((e) => new Date(e.at).getTime() <= now.getTime())).toBe(true);
      for (let i = 1; i < t.length; i++) expect(new Date(t[i - 1].at).getTime()).toBeGreaterThanOrEqual(new Date(t[i].at).getTime());
    }
  });
});
