// Lote 2 — lo que la app manda al servidor cuando escribe un operario: nunca costos.
import { describe, expect, it } from "vitest";
import { buildSeed, MAIN_DEMO_PROJECT_ID } from "@/lib/seed-data";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import * as ops from "@/lib/project-operations";
import { tallerCalls } from "@/lib/supabase/taller";

const seed = buildSeed(new Date("2026-10-08T12:00:00"));
const ctx: ops.Ctx = { actor: "Juan Pérez", now: "2026-10-08T12:00:00.000Z", role: "operator", operatorId: "op-juan" };
const base = { projects: seed.projects, stock: seed.stock, requests: [] };
const COST_KEYS = /amount|unit_cost|unitCost|hourly|sales_price|total/i;

describe("tallerCalls", () => {
  it("horas: una llamada a taller_log_hours, sin importes", () => {
    const p = seed.projects.find((x) => x.id === MAIN_DEMO_PROJECT_ID)!;
    const a = { id: "asg-x", projectId: p.id, itemId: "itm-mostrador", rubro: "carpinteria_madera" as const, operatorId: "op-juan", date: "2026-10-06", plannedHours: 4, createdBy: "x", createdAt: "" };
    const next = ops.logHours(p, seed.operators, [a], { assignmentId: "asg-x", hours: 2 }, DEFAULT_SETTINGS, ctx);
    const calls = tallerCalls(base, { ...base, projects: seed.projects.map((x) => (x.id === p.id ? next : x)) }, "org");
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("taller_log_hours");
    expect(Object.keys(calls[0].p).some((k) => COST_KEYS.test(k))).toBe(false);
  });
  it("pedido de material: una llamada a taller_request_material", () => {
    const req = { id: "req-1", projectId: MAIN_DEMO_PROJECT_ID, materialId: "bisagra", materialName: "Herraje bisagra", quantity: 4, unit: "u", requestedBy: "Juan Pérez", status: "open" as const, createdAt: ctx.now };
    const calls = tallerCalls(base, { ...base, requests: [req] }, "org");
    expect(calls.map((c) => c.fn)).toEqual(["taller_request_material"]);
  });
  it("sin cambios no llama a nada", () => {
    expect(tallerCalls(base, base, "org")).toEqual([]);
  });
});
