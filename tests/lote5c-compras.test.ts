// Lote 5C — Compras: funciones puras (líneas, estados, consolidado, alertas, historial, cotizador de materiales).
import { describe, expect, it } from "vitest";
import type { PurchaseLineStatus } from "@/types";
import { buildSeed } from "@/lib/seed-data";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import {
  consolidate,
  lineStatusOf,
  materialsQuote,
  overBudgetPurchases,
  pendingLines,
  purchaseHistory,
  purchaseLines,
  purchasingAlerts,
  recordPurchaseError,
  supplierPrices,
  toBuyWithin,
} from "@/lib/purchasing";

const seed = buildSeed(new Date("2026-10-15T12:00:00"));
const today = "2026-10-15";
const status = (projectId: string, lineId: string, s: PurchaseLineStatus["status"]): PurchaseLineStatus => ({ projectId, lineId, status: s, updatedBy: "x", updatedAt: "" });

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

describe("estado de una línea", () => {
  it("recibido manda; si se compró todo es comprado; si no, lo marcado o pendiente", () => {
    expect(lineStatusOf("received", 10, 0)).toBe("received");
    expect(lineStatusOf(undefined, 10, 10)).toBe("purchased");
    expect(lineStatusOf("quoting", 10, 10)).toBe("purchased");
    expect(lineStatusOf("quoting", 10, 4)).toBe("quoting");
    expect(lineStatusOf(undefined, 10, 4)).toBe("pending");
  });
});

describe("líneas de materiales de los proyectos abiertos", () => {
  const lines = purchaseLines(seed.projects, [status("p-1053", "bl-0407", "quoting")], today);
  it("solo proyectos abiertos y solo materiales, con lo comprado y lo que falta", () => {
    expect(new Set(lines.map((l) => l.projectId))).toEqual(new Set(seed.projects.filter((p) => !p.isClosed).map((p) => p.id)));
    const mel = lines.find((l) => l.projectId === "p-1053" && l.lineId === "bl-0404")!;
    expect(mel).toMatchObject({ needed: 30, purchased: 32, remaining: 0, status: "purchased" });
    const alu = lines.find((l) => l.lineId === "bl-0407")!;
    expect(alu).toMatchObject({ purchased: 0, remaining: 60, status: "quoting", needBy: "2026-10-10", daysLeft: -5 });
  });
  it("un monto directo cuenta como 1 unidad por su monto", () => {
    const paint = lines.find((l) => l.lineId === "bl-0410")!;
    expect(paint).toMatchObject({ quantity: null, needed: 1, budgetUnitCost: 500_000 });
  });
  it("lo pagado de más contra el presupuesto", () => {
    const mdf = lines.find((l) => l.projectId === "p-1042" && l.key === "mdf-18")!;
    expect(mdf.overBy).toBe(8 * 6_000); // 8 placas a 86.000 contra 80.000
  });
  it("un proyecto en Cotización aparece pero no compra", () => {
    expect(lines.filter((l) => l.projectId === "p-1056").every((l) => !l.canBuy)).toBe(true);
    expect(pendingLines(lines).some((l) => l.projectId === "p-1056")).toBe(false);
  });
  it("nunca trae precio de venta, rentabilidad ni mano de obra", () => {
    const keys = keysDeep([lines, consolidate(lines), purchaseHistory(seed.projects, seed.stock)]);
    for (const k of ["salesPrice", "margin", "profit", "baseline", "hourlyCost", "labor", "actualEntries"]) expect(keys.has(k), k).toBe(false);
  });
});

describe("qué comprar y consolidado", () => {
  const lines = purchaseLines(seed.projects, [], today);
  it("esta semana: lo que se necesita en 7 días o ya se necesitaba, primero lo más urgente", () => {
    const week = toBuyWithin(lines, today, 7);
    expect(week.map((l) => l.projectCode)).toContain("P-1051"); // arranca el 20/10 sin nada comprado
    expect(week.map((l) => l.projectCode)).toContain("P-1053"); // arrancó el 10/10 y le falta
    expect(week[0].needBy <= week[week.length - 1].needBy).toBe(true);
    expect(toBuyWithin(lines, today, 2).some((l) => l.projectCode === "P-1051")).toBe(false);
  });
  it("el mismo material de varios proyectos va junto, con lo que falta en total", () => {
    const pending = pendingLines(lines);
    const mel = consolidate(pending).find((c) => c.key === "mel-blanca-18")!;
    expect(mel.lines.map((l) => l.projectCode)).toEqual(["P-1051"]);
    const all = consolidate(lines).find((c) => c.key === "corredera")!;
    expect(all.lines.length).toBeGreaterThan(1);
    expect(all.remaining).toBe(all.lines.reduce((s, l) => s + l.remaining, 0));
    expect(all.status).toBe("pending");
  });
});

describe("compras más caras que lo presupuestado y alertas", () => {
  it("cada compra que pagó de más, con la diferencia y el %", () => {
    const over = overBudgetPurchases(seed.projects);
    const mdf = over.find((o) => o.projectCode === "P-1042" && o.materialName === "MDF 18 mm")!;
    expect(mdf).toMatchObject({ budgetUnitCost: 80_000, paidUnitCost: 86_000, overBy: 48_000, pct: 7.5 });
    expect(over.some((o) => o.projectCode === "P-0987")).toBe(false); // cerrado
  });
  it("alertas: material sin comprar a pocos días y compra más cara, trazables", () => {
    const alerts = purchasingAlerts({ projects: seed.projects, statuses: [], settings: DEFAULT_SETTINGS, today });
    const due = alerts.find((a) => a.kind === "purchase_due" && a.projectCode === "P-1051")!;
    expect(due.title).toMatch(/se necesitan en 5 días/);
    expect(due.records?.length).toBe(5);
    expect(alerts.find((a) => a.kind === "purchase_due" && a.projectCode === "P-1053")?.level).toBe("critical");
    expect(alerts.some((a) => a.kind === "purchase_cost" && a.records?.[0].startsWith("Compra "))).toBe(true);
    // Con 3 días de anticipación P-1051 (arranca en 5) todavía no avisa.
    const short = purchasingAlerts({ projects: seed.projects, statuses: [], settings: { ...DEFAULT_SETTINGS, purchaseLeadDays: 3 }, today });
    expect(short.some((a) => a.kind === "purchase_due" && a.projectCode === "P-1051")).toBe(false);
  });
});

describe("historial y precios por proveedor", () => {
  const history = purchaseHistory(seed.projects, seed.stock);
  it("compras de proyectos y del depósito, de la más nueva a la más vieja", () => {
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].date >= history[history.length - 1].date).toBe(true);
    expect(history.some((h) => h.destination === "P-1042")).toBe(true);
  });
  it("por material, cada proveedor con su último precio, del más barato al más caro", () => {
    const mdf = supplierPrices([
      { id: "a", date: "2026-01-01", key: "mdf", materialName: "MDF", supplier: "A", quantity: 1, unit: "placa", unitCost: 90, total: 90, destination: "P-1" },
      { id: "b", date: "2026-02-01", key: "mdf", materialName: "MDF", supplier: "A", quantity: 1, unit: "placa", unitCost: 80, total: 80, destination: "P-1" },
      { id: "c", date: "2026-02-01", key: "mdf", materialName: "MDF", supplier: "B", quantity: 1, unit: "placa", unitCost: 85, total: 85, destination: "Depósito" },
    ])[0];
    expect(mdf.suppliers).toEqual([
      { supplier: "A", lastPrice: 80, lastDate: "2026-02-01", minPrice: 80, maxPrice: 90, purchases: 2 },
      { supplier: "B", lastPrice: 85, lastDate: "2026-02-01", minPrice: 85, maxPrice: 85, purchases: 1 },
    ]);
  });
});

describe("registrar una compra", () => {
  const ok = { materialName: "MDF", unit: "placa", supplier: "Maderera", unitCost: 80_000, date: today, parts: [{ projectId: "p", lineId: "l", quantity: 2 }] };
  it("pide proveedor, precio pagado, fecha no futura y alguna cantidad", () => {
    expect(recordPurchaseError(ok, today)).toBeNull();
    expect(recordPurchaseError({ ...ok, supplier: " " }, today)).toMatch(/proveedor/);
    expect(recordPurchaseError({ ...ok, unitCost: 0 }, today)).toMatch(/precio/);
    expect(recordPurchaseError({ ...ok, date: "2026-10-16" }, today)).toMatch(/futura/);
    expect(recordPurchaseError({ ...ok, parts: [{ projectId: "p", lineId: "l", quantity: 0 }] }, today)).toMatch(/cantidad/);
  });
});

describe("cotizador de materiales", () => {
  it("solo materiales: cantidad con desperdicio × costo, sin mano de obra ni precio", () => {
    const q = materialsQuote([
      { name: "MDF", unit: "placa", quantity: 10, unitCost: 80_000, wastePct: 10 },
      { name: "", unit: "u", quantity: 1, unitCost: 5, wastePct: 0 },
    ]);
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].budgetQuantity).toBe(11);
    expect(q.total).toBe(880_000);
    expect(Object.keys(q)).toEqual(["lines", "total"]);
  });
});

describe("lo que Compras manda a la base (compras_save)", async () => {
  const { comprasPayload } = await import("@/lib/supabase/compras");
  const { addPurchase } = await import("@/lib/project-operations");
  const project = seed.projects.find((p) => p.id === "p-1051")!;
  const ctx = { actor: "Martín Ruiz", now: "2026-10-15T10:00:00.000Z", role: "compras" as const };
  it("una compra: la compra, su lote, su movimiento y la bitácora; ningún importe de venta", () => {
    const res = addPurchase(project, seed.stock, { materialId: "mel-blanca-18", materialName: "Melamina blanca 18 mm", quantity: 24, unit: "placa", unitCost: 51_000, supplier: "Placas del Plata", date: today }, ctx);
    const prev = { projects: seed.projects, stock: seed.stock, requests: [] };
    const next = { projects: seed.projects.map((p) => (p.id === project.id ? res.project : p)), stock: res.stock, requests: [] };
    const payload = comprasPayload(prev, next, "org")!;
    expect(payload.purchases).toHaveLength(1);
    expect(payload.purchases?.[0]).toMatchObject({ project_id: "p-1051", quantity: 24, unit_cost: 51_000, supplier: "Placas del Plata" });
    expect(payload.lots).toHaveLength(1);
    expect(payload.movements?.map((m) => m.kind)).toEqual(["purchase_in"]);
    expect(payload.activity?.map((a) => a.kind)).toEqual(["purchase"]);
    expect(keysDeep(payload).has("sales_price")).toBe(false);
    expect(comprasPayload(prev, prev, "org")).toBeNull();
  });
  it("Operario y Jefe de planta no compran", () => {
    for (const role of ["operator", "jefe_planta"] as const) {
      expect(() => addPurchase(project, seed.stock, { materialName: "X", quantity: 1, unit: "u", unitCost: 1, date: today }, { ...ctx, role })).toThrow(/Compras o un usuario Administrativo/);
    }
  });
});
