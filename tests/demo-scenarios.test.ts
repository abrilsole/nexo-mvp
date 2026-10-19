// Escenarios obligatorios de la demo, sobre el seed real de P-1042.
import { describe, expect, it } from "vitest";
import type { WorkAssignment } from "@/types";
import { buildSeed, MAIN_DEMO_PROJECT_ID } from "@/lib/seed-data";
import { projectEconomics } from "@/lib/calculations";
import { projectAlerts, projectHealth } from "@/lib/alerts";
import { materialRows } from "@/lib/material-reconciliation";
import { DEFAULT_SETTINGS as S } from "@/lib/constants";
import * as ops from "@/lib/project-operations";
import { todayISO } from "@/lib/formatting";
import { applyChange, availableToProject, releaseToWarehouse, projectHoldings } from "@/lib/stock";
import { projectMaterialFlow } from "@/lib/material-flow";

const ctx: ops.Ctx = { actor: "Laura Gómez", now: new Date().toISOString(), role: "owner" };
const today = todayISO();
const PLATE = { materialId: "mel-blanca-18", materialName: "Melamina blanca 18 mm", unit: "placa" };

function seed() {
  const s = buildSeed(new Date());
  const p = s.projects.find((x) => x.id === MAIN_DEMO_PROJECT_ID);
  if (!p) throw new Error("no P-1042");
  return { ...s, p };
}

describe("P-1042 — escenarios 1 a 3", () => {
  it("esperado 40%, proyectado ≈31%, En riesgo, causa Materiales", () => {
    const { p } = seed();
    const e = projectEconomics(p);
    expect(e.budgetTotal).toBe(7_200_000);
    expect(e.expectedProfit).toBe(4_800_000);
    expect(e.expectedMargin).toBeCloseTo(40);
    expect(e.projectedMargin!).toBeGreaterThan(30);
    expect(e.projectedMargin!).toBeLessThan(32);
    expect(e.mainDeviation?.category).toBe("materials");
    expect(e.materialActualCost).toBeGreaterThan(4_700_000);
    expect(e.materialActualCost).toBeLessThan(4_900_000);
    expect(projectHealth(p, projectAlerts(p, S, today))).toBe("risk");
  });
  it("melamina blanca: 10 presup., 12 compradas, 9 consumidas, 1 desperdicio, 2 sobrante", () => {
    const { p } = seed();
    const row = materialRows(p).find((r) => r.key === "mel-blanca-18")!;
    expect([row.budgetQty, row.purchasedQty, row.consumedQty, row.wasteQty, row.leftoverQty]).toEqual([10, 12, 9, 1, 2]);
    expect(row.imputedCost).toBe(500_000);
    const mdf = materialRows(p).find((r) => r.key === "mdf-18")!;
    expect(mdf.consumedQty).toBe(7);
    expect(mdf.variance).toBeGreaterThan(0);
  });
  it("el flujo del ledger coincide con el costo de materiales del proyecto", () => {
    const { p, stock } = seed();
    // Materiales también incluye trabajo comprado hecho (Lote 4): el ledger se compara con el costo de los consumos.
    expect(Math.abs(projectMaterialFlow(stock, p.id).attributableCost - projectEconomics(p).materialActualCost)).toBeLessThan(1);
  });
});

describe("escenario 4 y 5 — compra NO cambia margen, consumo SÍ", () => {
  it("registrar compra de 2 placas no modifica costo imputable ni margen y queda asignada al proyecto", () => {
    const { p, stock } = seed();
    const before = projectEconomics(p);
    const res = ops.addPurchase(p, stock, { ...PLATE, quantity: 2, unitCost: 50_000, date: today }, ctx);
    const e = projectEconomics(res.project);
    expect(e.actualCostToDate).toBe(before.actualCostToDate);
    expect(e.projectedMargin).toBe(before.projectedMargin);
    expect(e.purchasesTotal).toBe(before.purchasesTotal + 100_000);
    expect(availableToProject(res.stock, p.id, PLATE.materialId)).toBe(2);
    expect(projectMaterialFlow(res.stock, p.id).attributableCost).toBe(projectMaterialFlow(stock, p.id).attributableCost);
  });
  it("registrar consumo de 2 placas sí cambia costo y margen", () => {
    const { p, stock } = seed();
    const before = projectEconomics(p);
    const bought = ops.addPurchase(p, stock, { ...PLATE, quantity: 2, unitCost: 50_000, date: today }, ctx);
    const res = ops.registerUsage(bought.project, bought.stock, { ...PLATE, consumed: 2, waste: 0, date: today }, S, ctx);
    const e = projectEconomics(res.project);
    expect(e.actualCostToDate).toBe(before.actualCostToDate + 100_000);
    expect(e.projectedMargin!).toBeLessThan(before.projectedMargin!);
    expect(res.project.materialUsages.at(-1)?.unitCostOrigin).toBe("purchase");
    // Gestión (ledger) y proyecto (registros) dicen lo mismo.
    expect(projectMaterialFlow(res.stock, p.id).attributableCost).toBe(projectEconomics(res.project).materialActualCost);
  });
  it("no se puede consumir material que el proyecto no tiene asignado", () => {
    const { p, stock } = seed();
    expect(availableToProject(stock, p.id, PLATE.materialId)).toBe(0);
    expect(() => ops.registerUsage(p, stock, { ...PLATE, consumed: 1, waste: 0, date: today }, S, ctx)).toThrow(/No hay|Solo hay/);
  });
});

describe("escenario 6 — horas (siempre contra una asignación)", () => {
  /** Asignación de hoy en el mostrador de P-1042. */
  const asg = (operatorId: string, id = `asg-t-${operatorId}`, date = today): WorkAssignment => ({
    id, projectId: MAIN_DEMO_PROJECT_ID, itemId: "itm-mostrador", rubro: "carpinteria_madera", operatorId, date, plannedHours: 8, createdBy: "x", createdAt: "",
  });
  it("10 h × $15.000 del operario = $150.000, congeladas aunque cambie la tarifa; producto y rubro salen de la asignación", () => {
    const { p, operators } = seed();
    const before = projectEconomics(p);
    const after = ops.logHours(p, operators, [asg("op-juan")], { assignmentId: "asg-t-op-juan", hours: 10 }, S, ctx);
    const entry = after.actualEntries.at(-1)!;
    expect(entry.amount).toBe(150_000);
    expect(entry).toMatchObject({ operatorId: "op-juan", itemId: "itm-mostrador", rubro: "carpinteria_madera", assignmentId: "asg-t-op-juan", date: today });
    expect(projectEconomics(after).actualCostToDate).toBe(before.actualCostToDate + 150_000);
    // Subir la tarifa no cambia lo ya registrado.
    const raised = operators.map((o) => (o.id === "op-juan" ? { ...o, hourlyCost: 99_000 } : o));
    const next = ops.logHours(after, raised, [asg("op-juan", "asg-2")], { assignmentId: "asg-2", hours: 1 }, S, ctx);
    expect(next.actualEntries.at(-1)!.amount).toBe(99_000);
    expect(next.actualEntries.at(-2)!.amount).toBe(150_000);
  });
  it("sin asignación no hay horas; un operario solo carga sobre las suyas", () => {
    const { p, operators } = seed();
    expect(() => ops.logHours(p, operators, [], { assignmentId: "nada", hours: 2 }, S, ctx)).toThrow(/asignación/);
    const juan: ops.Ctx = { ...ctx, role: "operator", operatorId: "op-juan", actor: "Juan Pérez" };
    expect(() => ops.logHours(p, operators, [asg("op-diego")], { assignmentId: "asg-t-op-diego", hours: 2 }, S, juan)).toThrow(/no es tuya/);
    const ok = ops.logHours(p, operators, [asg("op-juan")], { assignmentId: "asg-t-op-juan", hours: 2 }, S, juan);
    expect(ok.actualEntries.at(-1)!.operatorId).toBe("op-juan");
  });
  it("bloquea más de 24 h por día y pide confirmar sobre la jornada", () => {
    const { p, operators } = seed();
    const a = [asg("op-juan")];
    expect(() => ops.logHours(p, operators, a, { assignmentId: a[0].id, hours: 25 }, S, ctx)).toThrow(/24/);
    expect(() => ops.logHours(p, operators, a, { assignmentId: a[0].id, hours: 17 }, S, ctx)).toThrow(/Confirmá/);
    const ok = ops.logHours(p, operators, a, { assignmentId: a[0].id, hours: 17, confirmHighHours: true }, S, ctx);
    expect(ok.actualEntries.at(-1)!.labor?.hours).toBe(17);
  });
});

describe("escenario 7 — registro de taller sin precio", () => {
  it("2 placas + 0,2 desperdicio + 0,3 reutilizable: valoriza sola y el sobrante queda en stock con su valor", () => {
    const { p, stock } = seed();
    const before = projectEconomics(p);
    const bought = ops.addPurchase(p, stock, { ...PLATE, quantity: 2.5, unitCost: 50_000, date: today }, ctx);
    const planta: ops.Ctx = { actor: "María Ruiz", now: new Date().toISOString(), role: "operator", operatorId: "op-juan" };
    const res = ops.registerUsage(
      bought.project, bought.stock,
      { ...PLATE, consumed: 2, waste: 0.2, leftover: { quantity: 0.3, dims: { lengthMm: 800, widthMm: 600 } }, date: today },
      S, planta,
    );
    const used = res.project.materialUsages.at(-1)!;
    expect(used.unitCost).toBe(50_000);
    expect(projectEconomics(res.project).materialActualCost).toBe(before.materialActualCost + 110_000);
    expect(projectHoldings(res.stock, p.id).filter((h) => h.lot.materialId === PLATE.materialId)).toHaveLength(0);
    const flow = projectMaterialFlow(res.stock, p.id).lines.find((l) => l.key === PLATE.materialId)!;
    expect(flow.recovered.value).toBe(100_000 + 15_000); // 2 placas de antes + 0,3 placas de ahora, a $50.000
  });
  it("reutilizar un sobrante: se asigna al proyecto y se imputa su valor", () => {
    const { p, stock } = seed();
    const lot = stock.lots.find((l) => l.kind === "leftover" && l.materialId === "mel-grafito-18")!;
    const assigned = ops.assignStockToProject([p], stock, { projectId: p.id, materialId: lot.materialId, materialName: lot.materialName, unit: lot.unit, quantity: 1, lotId: lot.id }, ctx);
    const proj = assigned.projects[0];
    const res = ops.registerUsage(proj, assigned.stock, { materialId: lot.materialId, materialName: lot.materialName, unit: lot.unit, consumed: 1, waste: 0, date: today }, S, ctx);
    const u = res.project.materialUsages.at(-1)!;
    expect(u.unitCost).toBe(lot.unitCost);
    expect(u.source).toBe("reused_leftover");
  });
});

describe("estados y ejecución", () => {
  it("Cotización bloquea consumo, desperdicio, horas y costos de ejecución", () => {
    const { projects, stock, operators } = seed();
    for (const id of ["p-1056"]) {
      const p = projects.find((x) => x.id === id)!;
      expect(() => ops.registerUsage(p, stock, { ...PLATE, consumed: 1, waste: 0, date: today }, S, ctx)).toThrow(/No se puede registrar/);
      const a: WorkAssignment = { id: "a", projectId: p.id, itemId: p.items[0].id, rubro: "carpinteria_madera", operatorId: "op-juan", date: today, plannedHours: 2, createdBy: "x", createdAt: "" };
      expect(() => ops.logHours({ ...p, assignedOperatorIds: ["op-juan"] }, operators, [a], { assignmentId: "a", hours: 2 }, S, ctx)).toThrow(/No se puede registrar/);
      expect(() => ops.addActual(p, { type: "logistics", description: "x", date: today, amount: 100 }, S, ctx)).toThrow(/No se puede registrar/);
    }
  });
  it("se avanza de a una etapa; sólo Administrativo corrige hacia atrás y con confirmación", () => {
    const { projects } = seed();
    const approved = projects.find((x) => x.id === "p-1051")!; // Aprobado
    expect(ops.changeStatus(approved, "production", ctx).status).toBe("production");
    const purchasing = ops.changeStatus(approved, "purchasing", ctx);
    expect(purchasing.status).toBe("purchasing");
    expect(() => ops.changeStatus(purchasing, "approved", ctx)).toThrow(/corrección/);
    expect(ops.changeStatus(purchasing, "approved", ctx, { confirmBack: true }).status).toBe("approved");
    expect(() => ops.changeStatus(purchasing, "production", { ...ctx, role: "operator" })).toThrow(/Administrativo/);
    expect(() => ops.changeStatus(purchasing, "completed", ctx)).toThrow(/Cerrar/);
  });
  it("al aprobar se congela el presupuesto original y no se pisa", () => {
    const { projects } = seed();
    const quotation = projects.find((x) => x.id === "p-1056")!;
    const approved = ops.changeStatus(quotation, "approved", ctx);
    expect(approved.baseline?.budgetTotal).toBe(projectEconomics(quotation).budgetTotal);
    // Desde Aprobado el costo presupuestado queda congelado (Lote 5A): solo se corrige con registro.
    expect(() => ops.addBudgetLine(approved, { category: "contingency", description: "extra", quantity: null, unit: "global", unitCost: 500_000 }, ctx)).toThrow(/congelado/);
    const back = ops.changeStatus(ops.changeStatus(approved, "purchasing", ctx), "approved", ctx, { confirmBack: true });
    expect(back.baseline).toEqual(approved.baseline);
  });
});

describe("escenario 9 y 10 — cierre e historial", () => {
  it("no deja cerrar con material asignado sin destino; con destino cierra y calcula margen real", () => {
    const { p, stock } = seed();
    const open = projectHoldings(stock, p.id);
    expect(open.length).toBeGreaterThan(0);
    expect(() => ops.closeProject(p, stock, ctx)).toThrow(/sin destino/);
    let s = stock;
    for (const h of open) {
      s = applyChange(s, releaseToWarehouse(s, { projectId: p.id, materialId: h.lot.materialId, quantity: h.quantity, lotId: h.lot.id }, ctx));
    }
    const closed = ops.closeProject(p, s, ctx);
    const e = projectEconomics(closed);
    expect(closed.status).toBe("completed");
    expect(closed.closedAt).toBeDefined();
    expect(e.finalMargin).toBeCloseTo(((12_000_000 - e.actualCostToDate) / 12_000_000) * 100);
    expect(projectAlerts(closed, S, today)).toHaveLength(0);
    expect(() => ops.addPurchase(closed, s, { materialName: "X", quantity: 1, unit: "u", unitCost: 1, date: today }, ctx)).toThrow();
    // Devolver al stock no cambia el costo imputable.
    expect(e.actualCostToDate).toBe(projectEconomics(p).actualCostToDate);
  });
  it("costo presupuestado congelado en producción", () => {
    const { p } = seed();
    expect(() => ops.addBudgetLine(p, { category: "contingency", description: "x", quantity: null, unit: "global", unitCost: 1 }, ctx)).toThrow(/congelado/);
  });
});
