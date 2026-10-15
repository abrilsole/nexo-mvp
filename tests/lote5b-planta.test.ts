// Lote 5B — planta: asignaciones, carga por día, pendientes, desvío de horas, alertas y reporte de horas.
import { describe, expect, it } from "vitest";
import type { Project } from "@/types";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { buildSeed, MAIN_DEMO_PROJECT_ID } from "@/lib/seed-data";
import {
  addDays,
  assignmentError,
  dayDeviations,
  dayLoad,
  exceeds,
  laborNeeds,
  pendingAssignments,
  plantAlerts,
  rubroHours,
  thresholdOf,
  workWeek,
} from "@/lib/plant";
import { hoursReport } from "@/lib/hours-report";
import { checkHours } from "@/lib/project-rules";
import { line, project } from "./helpers";

const NOW = new Date("2026-10-15T12:00:00"); // jueves
const TODAY = "2026-10-15";
const seed = buildSeed(NOW);
const t = thresholdOf(DEFAULT_SETTINGS);

describe("fechas y semana", () => {
  it("la semana de trabajo va de lunes a viernes", () => {
    expect(workWeek(TODAY)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(workWeek("2026-10-18")).toEqual(workWeek(TODAY)); // domingo → la misma semana
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("mano de obra estimada por rubro", () => {
  it("toma las horas del presupuesto y los operarios que pidió el Cotizador", () => {
    const p = project({
      budgetLines: [
        line("labor", 80, 19_000, { rubro: "carpinteria_madera", description: "Carpintería madera: mano de obra (2 operarios × 40 h)" }),
        line("labor", 10, 38_000, { rubro: "carpinteria_madera", description: "Carpintería madera: horas extra (2 operarios × 5 h, ×2)" }),
        line("labor", 12, 19_000, { rubro: "montaje", workers: 3, description: "Montaje" }),
        line("labor", null, 500_000, { rubro: "montaje", description: "Montaje: importe" }),
        line("design", 6, 27_000, { rubro: "carpinteria_madera" }),
      ],
    });
    expect(laborNeeds(p)).toEqual([
      { rubro: "carpinteria_madera", hours: 90, workers: 2 },
      { rubro: "montaje", hours: 12, workers: 3 },
    ]);
  });
});

describe("asignaciones y carga del día", () => {
  it("valida proyecto, operario, día y horas", () => {
    const ctx = { projects: seed.projects, operators: seed.operators };
    const ok = { projectId: MAIN_DEMO_PROJECT_ID, rubro: "carpinteria_madera" as const, operatorId: "op-juan", date: TODAY, plannedHours: 4 };
    expect(assignmentError(ok, ctx)).toBeNull();
    expect(assignmentError({ ...ok, projectId: "p-1056" }, ctx)).toMatch(/Aprobado e Instalación/);
    expect(assignmentError({ ...ok, operatorId: "op-x" }, ctx)).toMatch(/operario/);
    expect(assignmentError({ ...ok, plannedHours: 0 }, ctx)).toMatch(/mayores a cero/);
    expect(assignmentError({ ...ok, plannedHours: 25 }, ctx)).toMatch(/24 h/);
  });
  it("con la jornada de 9,5 h: Diego tiene 12 h hoy (2,5 h extra) y Juan 9 h (entra)", () => {
    expect(dayLoad(seed.assignments, "op-diego", TODAY, 9.5)).toMatchObject({ planned: 12, normalHours: 9.5, overtimeHours: 2.5, overloaded: true });
    expect(dayLoad(seed.assignments, "op-juan", TODAY, 9.5)).toMatchObject({ planned: 9, overtimeHours: 0, overloaded: false });
  });
  it("pendientes de asignar: rubros con menos operarios que los pedidos, por fecha de entrega", () => {
    const pending = pendingAssignments(seed.projects, seed.assignments, TODAY);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.map((p) => p.dueDate)).toEqual([...pending.map((p) => p.dueDate)].sort());
    expect(pending.every((p) => p.missing === p.workers - p.assigned && p.missing > 0)).toBe(true);
    expect(pending.some((p) => p.projectId === "p-1051")).toBe(true); // aprobado y sin nadie
    expect(pending.some((p) => p.projectId === "p-1056")).toBe(false); // cotización: todavía no se asigna
  });
});

describe("desvío de horas", () => {
  it("25 % o 2 h por encima, lo que ocurra primero", () => {
    expect(exceeds(8, 9.5, t)).toBe(false); // +1,5 h, +19 %
    expect(exceeds(8, 10, t)).toBe(true); // +2 h
    expect(exceeds(2, 2.6, t)).toBe(true); // +0,6 h, +30 %
    expect(exceeds(8, 7, t)).toBe(false);
    expect(exceeds(8, 10, { pct: 50, hours: 3 })).toBe(false); // el umbral se configura
  });
  it("por asignación del día: ayer Juan tenía 4 h previstas y cargó 9 h; Diego 8 y 7,5", () => {
    const devs = dayDeviations(seed.projects, seed.assignments, t);
    const juan = devs.find((d) => d.operatorId === "op-juan" && d.date === "2026-10-14")!;
    expect(juan).toMatchObject({ planned: 4, actual: 9, over: 5, pct: 125, flagged: true });
    expect(juan.records).toHaveLength(1);
    const diego = devs.find((d) => d.operatorId === "op-diego" && d.date === "2026-10-14")!;
    expect(diego).toMatchObject({ planned: 8, actual: 7.5, flagged: false });
    // Lo que todavía no se cargó no es un desvío.
    expect(devs.some((d) => d.date === TODAY)).toBe(false);
  });
  it("acumulado por rubro: horas estimadas en el presupuesto vs cargadas", () => {
    const main = seed.projects.find((p) => p.id === MAIN_DEMO_PROJECT_ID)!;
    const r = rubroHours(main, t).find((x) => x.rubro === "carpinteria_madera")!;
    expect(r.estimated).toBe(100);
    expect(r.actual).toBe(129); // 20 + 30 + 30 + 40 + 9 (ayer)
    expect(r.flagged).toBe(true);
  });
  it("cargar horas cambia el desvío (valor derivado)", () => {
    const p: Project = project({ id: "p1", status: "production", budgetLines: [line("labor", 10, 1, { rubro: "carpinteria_madera" })] });
    const a = [{ id: "a1", projectId: "p1", rubro: "carpinteria_madera" as const, operatorId: "op1", date: TODAY, plannedHours: 4, createdBy: "", createdAt: "" }];
    expect(dayDeviations([p], a, t)).toEqual([]);
    const withHours = {
      ...p,
      actualEntries: [
        { id: "e1", projectId: "p1", date: TODAY, type: "labor" as const, category: "labor" as const, description: "", amount: 0, labor: { role: "x", workerName: "Op", hours: 7, hourlyCost: 0 }, operatorId: "op1", rubro: "carpinteria_madera" as const, assignmentId: "a1", createdBy: "", createdAt: "" },
      ],
    };
    expect(dayDeviations([withHours], a, t)[0]).toMatchObject({ actual: 7, over: 3, flagged: true });
  });
});

describe("alertas de planta", () => {
  const alerts = plantAlerts({ projects: seed.projects, assignments: seed.assignments, operators: seed.operators, settings: DEFAULT_SETTINGS, hoursPerDay: 9.5, today: TODAY });
  it("desvío del día, explicable y trazable hasta el registro de horas", () => {
    const a = alerts.find((x) => x.id.includes("hours-day:op-juan:2026-10-14"))!;
    expect(a.title).toBe("Juan Pérez trabajó 5 h más de lo previsto en Carpintería madera");
    expect(a.message).toBe("El 14/10/2026 se previeron 4 h y se cargaron 9 h (+5 h, +125 %).");
    expect(a.records?.[0]).toMatch(/14\/10\/2026 · Juan Pérez · 9 h \(registro act-/);
  });
  it("operario sobrecargado y rubro por encima de lo estimado", () => {
    expect(alerts.some((x) => x.kind === "overload" && x.title.startsWith("Diego Sosa tiene 12 h"))).toBe(true);
    expect(alerts.some((x) => x.kind === "hours" && x.id.includes("hours-rubro"))).toBe(true);
  });
  it("ninguna alerta de planta lleva importes", () => {
    expect(alerts.every((a) => a.impactAmount === undefined && !/\$/.test(a.message + a.title))).toBe(true);
  });
});

describe("carga de horas: aviso por la jornada, bloqueo a las 24 h", () => {
  const entries = [{ type: "labor" as const, date: TODAY, operatorId: "op1", labor: { role: "x", workerName: "x", hours: 8, hourlyCost: 0 } }];
  it("avisa si pasa la jornada, bloquea por encima de 24 h y si las horas no son más que 0", () => {
    expect(checkHours(entries, "op1", TODAY, 1, TODAY, 9.5).level).toBe("ok");
    expect(checkHours(entries, "op1", TODAY, 2, TODAY, 9.5)).toMatchObject({ level: "warn", dayTotal: 10 });
    expect(checkHours(entries, "op1", TODAY, 17, TODAY, 9.5).level).toBe("block");
    expect(checkHours(entries, "op1", TODAY, 0, TODAY, 9.5).level).toBe("block");
  });
});

describe("Horas del Administrativo: estimadas vs reales", () => {
  const report = hoursReport({ projects: seed.projects, assignments: seed.assignments, operators: seed.operators, today: TODAY, threshold: t });
  it("por operario: previstas en las asignaciones hasta hoy vs cargadas esos días, con el costo del día", () => {
    const juan = report.byOperator.find((r) => r.key === "op-juan")!;
    expect(juan).toMatchObject({ estimated: 21, actual: 17, diff: -4, actualCost: 17 * 15_000 }); // hoy todavía no cargó
  });
  it("por proyecto y por rubro, con la diferencia y el %", () => {
    const main = report.byProject.find((r) => r.key === MAIN_DEMO_PROJECT_ID)!;
    expect(main).toMatchObject({ estimated: 100, actual: 129, diff: 29, pct: 29, flagged: true });
    expect(main.estimatedCost).toBe(1_500_000);
    expect(report.byRubro.find((r) => r.label === "Carpintería madera")?.actual).toBeGreaterThan(0);
  });
});
