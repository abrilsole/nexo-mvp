// Lote 5A — vistas de Compras y Jefe de planta: solo los datos que cada rol puede ver.
import { describe, expect, it } from "vitest";
import { buildSeed } from "@/lib/seed-data";
import { plantView, purchasingView } from "@/lib/role-views";

const seed = buildSeed(new Date("2026-10-13T12:00:00"));

/** Todas las claves de un objeto, a cualquier profundidad. */
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

describe("Compras: proyectos con su lista de materiales", () => {
  const view = purchasingView(seed.projects);
  it("solo proyectos abiertos, solo líneas de materiales, con lo ya comprado", () => {
    expect(view.map((b) => b.id)).toEqual(seed.projects.filter((p) => !p.isClosed).map((p) => p.id));
    const main = view.find((b) => b.lines.some((l) => l.purchased > 0));
    expect(main).toBeDefined();
    const project = seed.projects.find((p) => p.id === main!.id)!;
    expect(main!.lines).toHaveLength(project.budgetLines.filter((l) => l.category === "materials").length);
    expect(main!.materialsCost).toBeCloseTo(project.budgetLines.filter((l) => l.category === "materials").reduce((s, l) => s + l.total, 0), 2);
  });
  it("nunca trae precio de venta, rentabilidad ni mano de obra", () => {
    const keys = keysDeep(view);
    for (const k of ["salesPrice", "margin", "profit", "baseline", "hourlyCost", "labor"]) expect(keys.has(k), k).toBe(false);
  });
});

describe("Jefe de planta: operarios y proyectos sin importes", () => {
  const view = plantView(seed.projects, seed.operators);
  it("cada operario con sus proyectos abiertos y sus horas", () => {
    const juan = view.operators.find((o) => o.id === "op-juan")!;
    expect(juan.projects.length).toBeGreaterThan(0);
    expect(juan.hours).toBeGreaterThan(0);
  });
  it("cada proyecto abierto con sus operarios y horas", () => {
    expect(view.projects.every((p) => typeof p.hours === "number")).toBe(true);
    expect(view.projects.some((p) => p.operators.length > 0)).toBe(true);
  });
  it("ningún importe", () => {
    const keys = keysDeep(view);
    for (const k of ["salesPrice", "unitCost", "total", "amount", "hourlyCost", "materialsCost", "margin"]) expect(keys.has(k), k).toBe(false);
  });
});
