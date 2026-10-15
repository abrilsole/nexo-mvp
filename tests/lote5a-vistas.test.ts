// Lote 5A — vista del Jefe de planta: solo los datos que puede ver (Compras: tests/lote5c-compras.test.ts).
import { describe, expect, it } from "vitest";
import { buildSeed } from "@/lib/seed-data";
import { plantView } from "@/lib/role-views";

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
