// Compras (Lotes 5C y 6) — funciones puras: necesidades, órdenes de compra, factura → costo real, estado de
// materiales, alertas, historial y cotizador de materiales. Sobre el seed real (proyecto estrella P-1058).
import { describe, expect, it } from "vitest";
import { buildSeed, STAR_PROJECT_ID } from "@/lib/seed-data";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import {
  invoiceEntries,
  invoiceError,
  materialCosts,
  materialNeeds,
  materialsQuote,
  materialsState,
  needsToBuy,
  nextOrderNumber,
  orderDraftError,
  orderTotal,
  overBudgetPurchases,
  purchaseHistory,
  purchasingAlerts,
  receivedState,
  receiveOrder,
  supplierPrices,
  toBuyWithin,
} from "@/lib/purchasing";
import { applyChange, projectHoldings } from "@/lib/stock";

const NOW = new Date("2026-10-15T12:00:00");
const today = "2026-10-15";
const seed = buildSeed(NOW);
const star = () => seed.projects.find((p) => p.id === STAR_PROJECT_ID)!;
const needs = materialNeeds(seed.projects, seed.orders, seed.stock, today);
const of = (projectId: string, materialId: string) => needs.find((n) => n.projectId === projectId && n.materialId === materialId)!;

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}

describe("necesidades de compra (proyectos aprobados)", () => {
  it("proyecto estrella: multilaminado recibido, caño en orden (180 de 300 recibidos), tapacanto en un borrador", () => {
    expect(of(STAR_PROJECT_ID, "multilaminado-18")).toMatchObject({ status: "received", needed: 20, ordered: 20, receivedFromOrders: 20, toBuy: 0 });
    expect(of(STAR_PROJECT_ID, "cano-40")).toMatchObject({ status: "ordered", ordered: 300, receivedFromOrders: 180, toBuy: 0 });
    expect(of(STAR_PROJECT_ID, "tapacanto")).toMatchObject({ status: "ordered", ordered: 200 });
    expect(of(STAR_PROJECT_ID, "cano-40").orders.map((o) => o.number)).toEqual(["OC-0002"]);
  });
  it("un proyecto aprobado sin compras: todo por comprar; las cotizaciones y los cerrados no aparecen", () => {
    const p1051 = needs.filter((n) => n.projectId === "p-1051");
    expect(p1051.length).toBeGreaterThan(0);
    expect(p1051.every((n) => n.status === "to_buy" || n.fromStock > 0)).toBe(true);
    expect(needs.some((n) => n.projectId === "p-1056")).toBe(false);
    expect(needs.some((n) => n.projectId === "p-0987")).toBe(false);
  });
  it("netea el stock libre del depósito: lo que hay en stock no se vuelve a pedir", () => {
    const withStock = needs.filter((n) => n.fromStock > 0);
    expect(withStock.length).toBeGreaterThan(0);
    for (const n of withStock) expect(n.toBuy).toBeCloseTo(Math.max(0, n.needed - n.ordered - n.direct) - n.fromStock, 2);
  });
  it("las compras directas anteriores cuentan como recibidas", () => {
    const mel = of("p-1053", "mel-blanca-18");
    expect(mel).toMatchObject({ direct: 32, status: "received", toBuy: 0 });
  });
  it("qué pedir esta semana: lo que arranca en 7 días o menos y falta pedir", () => {
    const week = toBuyWithin(needs, today, 7);
    expect(week.every((n) => n.toBuy > 0 && n.needBy <= "2026-10-22")).toBe(true);
    expect(week.some((n) => n.projectId === "p-1051")).toBe(true);
    expect(needsToBuy(needs).length).toBeGreaterThanOrEqual(week.length);
  });
  it("nunca trae precio de venta, rentabilidad ni mano de obra", () => {
    const keys = keysDeep([needs, purchaseHistory(seed.projects, seed.stock)]);
    for (const k of ["salesPrice", "margin", "profit", "baseline", "hourlyCost", "labor", "actualEntries"]) expect(keys.has(k), k).toBe(false);
  });
});

describe("estado de materiales del proyecto", () => {
  it("Sin comprar / En camino / Completo", () => {
    expect(materialsState(needs, STAR_PROJECT_ID)).toBe("on_the_way");
    expect(materialsState(needs, "p-1051")).toBe("none");
    expect(materialsState(needs, "p-1045")).toBe("on_the_way");
    expect(materialsState(needs, "no-existe")).toBeNull();
  });
  it("recibir todo cambia el estado (valor derivado)", () => {
    // Recibe lo que falta del caño y el tapacanto (enviando antes el borrador).
    const orders = seed.orders.map((o) => (o.status === "draft" ? { ...o, status: "sent" as const } : o));
    let stock = seed.stock;
    const received = orders.map((o) => {
      const r = receiveOrder(o, o.lines.map((l) => ({ lineId: l.id, quantity: l.quantity - l.receivedQuantity })).filter((x) => x.quantity > 0), seed.projects, { actor: "x", now: NOW.toISOString(), today });
      stock = applyChange(stock, r.change);
      return r.order;
    });
    expect(received.every((o) => o.received === "yes")).toBe(true);
    expect(materialsState(materialNeeds(seed.projects, received, stock, today), STAR_PROJECT_ID)).toBe("complete");
    // El material recibido entra al stock del proyecto con el costo real de la orden.
    const cano = projectHoldings(stock, STAR_PROJECT_ID).filter((h) => h.lot.materialId === "cano-40");
    expect(cano.reduce((s, h) => s + h.quantity, 0)).toBeCloseTo(300);
    expect(cano.every((h) => h.lot.unitCost === 10_500)).toBe(true);
  });
  it("no se recibe más de lo pedido ni antes de enviar", () => {
    const sent = seed.orders.find((o) => o.number === "OC-0002")!;
    expect(() => receiveOrder(sent, [{ lineId: sent.lines[0].id, quantity: 200 }], seed.projects, { actor: "x", now: "", today })).toThrow(/más de lo pedido/);
    const draft = seed.orders.find((o) => o.status === "draft")!;
    expect(() => receiveOrder(draft, [{ lineId: draft.lines[0].id, quantity: 1 }], seed.projects, { actor: "x", now: "", today })).toThrow(/enviá/);
    expect(receivedState([{ quantity: 10, receivedQuantity: 0 }])).toBe("no");
    expect(receivedState([{ quantity: 10, receivedQuantity: 4 }])).toBe("partial");
    expect(receivedState([{ quantity: 10, receivedQuantity: 10 }])).toBe("yes");
  });
});

describe("costo de materiales: estimado vs real (factura)", () => {
  it("el proyecto estrella: real = lo facturado en OC-0001 y OC-0002, cada importe hasta su factura", () => {
    const c = materialCosts(star(), seed.orders);
    const multi = c.rows.find((r) => r.description.startsWith("Multilaminado"))!;
    expect(multi).toMatchObject({ estimated: 1_900_000, real: 1_960_000, diff: 60_000 });
    expect(multi.sources[0].label).toBe("OC-0001 · factura A-0003-00012841");
    const cano = c.rows.find((r) => r.description.startsWith("Caño"))!;
    expect(cano).toMatchObject({ estimated: 2_700_000, real: 3_150_000, diff: 450_000 });
    const tapa = c.rows.find((r) => r.description === "Tapacanto")!;
    expect(tapa.real).toBe(0); // en borrador: todavía no hay costo real
  });
  it("registrar la factura actualiza el costo real; marcar pagada no lo cambia", () => {
    const draft = { ...seed.orders.find((o) => o.status === "draft")!, status: "sent" as const };
    const inv = { invoiceNumber: "C-1", invoiceAmount: orderTotal(draft), invoiceDate: today };
    expect(invoiceError(draft, inv)).toBeNull();
    const entries = invoiceEntries(draft, inv, "Martín Ruiz", NOW.toISOString());
    const p = star();
    const invoiced = { ...p, purchaseEntries: [...p.purchaseEntries, ...entries] };
    const orders = seed.orders.map((o) => (o.id === draft.id ? { ...draft, status: "invoiced" as const, invoiceNumber: "C-1" } : o));
    expect(materialCosts(invoiced, orders).real - materialCosts(p, seed.orders).real).toBe(200 * 1_050);
    const paid = orders.map((o) => (o.id === draft.id ? { ...o, paid: true } : o));
    expect(materialCosts(invoiced, paid).real).toBe(materialCosts(invoiced, orders).real);
    expect(invoiceError({ ...draft, status: "draft" }, inv)).toMatch(/Enviada/);
    expect(invoiceError(draft, { ...inv, invoiceNumber: " " })).toMatch(/número/);
  });
});

describe("órdenes de compra", () => {
  it("número correlativo y validaciones", () => {
    expect(nextOrderNumber(seed.orders)).toBe("OC-0004");
    expect(nextOrderNumber([])).toBe("OC-0001");
    const ok = { supplier: "Maderera", date: today, lines: [{ projectId: "p", budgetLineId: "l", materialName: "X", unit: "u", quantity: 2, unitCost: 10 }] };
    expect(orderDraftError(ok)).toBeNull();
    expect(orderDraftError({ ...ok, supplier: "" })).toMatch(/proveedor/);
    expect(orderDraftError({ ...ok, lines: [] })).toMatch(/al menos un material/);
    expect(orderDraftError({ ...ok, lines: [{ ...ok.lines[0], unitCost: 0 }] })).toMatch(/costo unitario real/);
  });
});

describe("alertas de Compras", () => {
  const alerts = purchasingAlerts({ projects: seed.projects, orders: seed.orders, stock: seed.stock, settings: DEFAULT_SETTINGS, today });
  it("material que falta pedir a pocos días del inicio, trazable", () => {
    const due = alerts.find((a) => a.kind === "purchase_due" && a.projectCode === "P-1051")!;
    expect(due.title).toMatch(/sin pedir: se necesitan en 5 días/);
    expect(due.records?.length).toBeGreaterThan(0);
  });
  it("compra que costó más de lo estimado (desde el % de Atención): el caño, +16,7 %", () => {
    const cost = alerts.find((a) => a.kind === "purchase_cost" && a.projectCode === "P-1058")!;
    expect(cost.title).toBe("Caño estructural 40×40: costó 16,7 % más que lo estimado");
    expect(overBudgetPurchases(seed.projects).find((o) => o.projectCode === "P-1058" && o.materialName.startsWith("Caño"))?.overBy).toBe(300 * 1_500);
  });
});

describe("historial y precios por proveedor", () => {
  const history = purchaseHistory(seed.projects, seed.stock);
  it("compras de proyectos (facturas y directas) y del depósito", () => {
    expect(history.some((h) => h.supplier === "Hierros Sur" && h.unitCost === 10_500)).toBe(true);
    expect(history[0].date >= history[history.length - 1].date).toBe(true);
  });
  it("por material, cada proveedor con su último precio, del más barato al más caro", () => {
    const mdf = supplierPrices([
      { id: "a", date: "2026-01-01", key: "mdf", materialName: "MDF", supplier: "A", quantity: 1, unit: "placa", unitCost: 90, total: 90, destination: "P-1" },
      { id: "b", date: "2026-02-01", key: "mdf", materialName: "MDF", supplier: "A", quantity: 1, unit: "placa", unitCost: 80, total: 80, destination: "P-1" },
      { id: "c", date: "2026-02-01", key: "mdf", materialName: "MDF", supplier: "B", quantity: 1, unit: "placa", unitCost: 85, total: 85, destination: "Depósito" },
    ])[0];
    expect(mdf.suppliers.map((s) => [s.supplier, s.lastPrice, s.minPrice, s.maxPrice])).toEqual([
      ["A", 80, 80, 90],
      ["B", 85, 85, 85],
    ]);
  });
});

describe("cotizador de materiales", () => {
  it("solo materiales: cantidad con desperdicio × costo, sin mano de obra ni precio", () => {
    const q = materialsQuote([
      { name: "MDF", unit: "placa", quantity: 10, unitCost: 80_000, wastePct: 10 },
      { name: "", unit: "u", quantity: 1, unitCost: 5, wastePct: 0 },
    ]);
    expect(q.lines).toHaveLength(1);
    expect(q.total).toBe(880_000);
    expect(Object.keys(q)).toEqual(["lines", "total"]);
  });
});

describe("diferencia estimado vs real", () => {
  it("se mide solo en lo ya facturado; lo pendiente se informa aparte", () => {
    const c = materialCosts(star(), seed.orders);
    expect(c.diff).toBe(60_000 + 450_000);
    expect(c.pendingEstimated).toBe(200_000 + 600_000);
  });
});
