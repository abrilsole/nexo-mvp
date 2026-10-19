// Lote 1C — baja de operarios con reasignación de proyectos.
import { describe, expect, it } from "vitest";
import type { Operator, Project } from "@/types";
import {
  activeOperators,
  deactivateOperator,
  openProjectsOf,
  projectsForOperator,
  reactivateOperator,
  reassignmentPlanError,
} from "@/lib/operators";
import { assignOperators, reassignForDeactivation } from "@/lib/project-operations";
import { projectAlerts, projectHealth } from "@/lib/alerts";
import { DEFAULT_SETTINGS as S } from "@/lib/constants";
import { project, usage } from "./helpers";

const NOW = "2026-10-08T12:00:00.000Z";
const TODAY = "2026-01-20";
const ctx = { actor: "Gestión", now: NOW, role: "owner" as const };
const juan: Operator = { id: "op-juan", name: "Juan", role: "Armado", hourlyCost: 10, active: true, createdAt: NOW };
const ana: Operator = { id: "op-ana", name: "Ana", role: "Carpintería", hourlyCost: 12, active: true, createdAt: NOW };
const OPS = [juan, ana];
const hours = {
  id: "h1", projectId: "p1", date: "2026-01-05", type: "labor" as const, category: "labor" as const, description: "Armado — Juan",
  amount: 100, operatorId: "op-juan", labor: { role: "Armado", hours: 10, hourlyCost: 10 }, createdBy: "t", createdAt: NOW,
};
const p1: Project = project({ id: "p1", code: "P-1", status: "production", assignedOperatorIds: ["op-juan"], actualEntries: [hours] });
const p2: Project = project({ id: "p2", code: "P-2", status: "installation", assignedOperatorIds: ["op-juan", "op-ana"] });
const done: Project = project({ id: "p3", code: "P-3", status: "completed", isClosed: true, assignedOperatorIds: ["op-juan"] });

/** Lo mismo que hace la acción del store: validar el plan, reasignar y dar de baja. */
function deactivate(projects: Project[], plan: Record<string, string | null>) {
  const err = reassignmentPlanError(OPS, projects, "op-juan", plan);
  if (err) throw new Error(err);
  const open = new Set(openProjectsOf(projects, "op-juan").map((p) => p.id));
  return {
    projects: projects.map((p) => (open.has(p.id) ? reassignForDeactivation(p, "op-juan", plan[p.id] ?? null, OPS, ctx) : p)),
    operators: deactivateOperator(OPS, "op-juan", NOW),
  };
}

describe("baja con proyectos activos", () => {
  it("lista solo los proyectos no finalizados donde está asignado", () => {
    expect(openProjectsOf([p1, p2, done], "op-juan").map((p) => p.code)).toEqual(["P-1", "P-2"]);
  });
  it("exige un destino para cada proyecto", () => {
    expect(reassignmentPlanError(OPS, [p1, p2], "op-juan", {})).toMatch(/P-1/);
    expect(reassignmentPlanError(OPS, [p1, p2], "op-juan", { p1: "op-ana" })).toMatch(/P-2/);
    expect(() => deactivate([p1, p2], { p1: "op-ana" })).toThrow(/P-2/);
    expect(reassignmentPlanError(OPS, [p1, p2], "op-juan", { p1: "op-ana", p2: null })).toBeNull();
  });
  it("no acepta como destino a quien se da de baja ni a un operario inactivo", () => {
    expect(reassignmentPlanError(OPS, [p1], "op-juan", { p1: "op-juan" })).toMatch(/otra persona/);
    const inactive = deactivateOperator(OPS, "op-ana", NOW);
    expect(reassignmentPlanError(inactive, [p1], "op-juan", { p1: "op-ana" })).toMatch(/no está activo/);
  });
  it("aplica el destino: reemplaza o deja sin asignar, y deja registro en la Actividad", () => {
    const r = deactivate([p1, p2, done], { p1: "op-ana", p2: null });
    const [a, b, c] = r.projects;
    expect(a.assignedOperatorIds).toEqual(["op-ana"]);
    expect(b.assignedOperatorIds).toEqual(["op-ana"]);
    expect(c.assignedOperatorIds).toEqual(["op-juan"]); // finalizado: el historial no se toca
    expect(a.activity[0].message).toMatch(/Ana/);
    expect(r.operators.find((o) => o.id === "op-juan")?.active).toBe(false);
  });
  it("sin proyectos abiertos no pide destino", () => {
    expect(reassignmentPlanError(OPS, [done], "op-juan", {})).toBeNull();
  });
});

describe("proyecto sin operario asignado", () => {
  it("genera la alerta de Atención y pone el proyecto en Atención", () => {
    const { projects } = deactivate([p1], { p1: null });
    const alerts = projectAlerts(projects[0], S, TODAY);
    const a = alerts.find((x) => x.kind === "staffing");
    expect(a?.title).toBe("Proyecto sin operario asignado");
    expect(a?.level).toBe("warning");
    const withData = { ...projects[0], materialUsages: [usage({ quantityConsumed: 1, unitCost: 1 })] };
    expect(projectHealth(withData, projectAlerts(withData, S, TODAY).filter((x) => x.kind === "staffing"))).toBe("attention");
  });
  it("se resuelve sola al asignar a alguien", () => {
    const { projects, operators } = deactivate([p1], { p1: null });
    const staffed = assignOperators(projects[0], ["op-ana"], operators, ctx);
    expect(projectAlerts(staffed, S, TODAY).some((x) => x.kind === "staffing")).toBe(false);
  });
  it("Aprobado admite trabajo y avisa si falta asignar un operario", () => {
    expect(projectAlerts(project({ status: "approved" }), S, TODAY).some((x) => x.kind === "staffing")).toBe(true);
  });
});

describe("historial y reactivación", () => {
  it("las horas y costos ya cargados no cambian", () => {
    const { projects } = deactivate([p1], { p1: "op-ana" });
    expect(projects[0].actualEntries).toEqual([hours]);
    expect(projects[0].actualEntries[0].operatorId).toBe("op-juan");
  });
  it("reactivar lo vuelve a dejar elegible para equipos y Taller", () => {
    const { projects, operators } = deactivate([p1], { p1: null });
    expect(activeOperators(operators).some((o) => o.id === "op-juan")).toBe(false);
    const back = reactivateOperator(operators, "op-juan");
    expect(activeOperators(back).some((o) => o.id === "op-juan")).toBe(true);
    const reassigned = assignOperators(projects[0], ["op-juan"], back, ctx);
    expect(reassigned.assignedOperatorIds).toEqual(["op-juan"]);
    expect(projectsForOperator([reassigned], "op-juan", back)).toHaveLength(1);
  });
});
