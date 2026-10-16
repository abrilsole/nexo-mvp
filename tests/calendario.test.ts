// Lote 6 · Fase 3 — días laborales por operario, excepciones y capacidad diaria (funciones puras).
import { describe, expect, it } from "vitest";
import type { DayException, WorkAssignment } from "@/types";
import { buildSeed } from "@/lib/seed-data";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { plantAlerts } from "@/lib/plant";
import {
  calendarCell,
  dayCapacity,
  exceptionError,
  fullWeek,
  operatorWorkdays,
  projectColorIndex,
  workDaysLabel,
  workDaysOf,
} from "@/lib/schedule";

// 2026-10-16 es viernes; 2026-10-17 sábado.
const juan: { id: string; workDays?: number[] } = { id: "op-juan" };
const sofia = { id: "op-sofia", workDays: [1, 2, 3, 4] };
const exc = (x: Partial<DayException>): DayException => ({ operatorId: "op-juan", date: "2026-10-17", works: true, createdBy: "Jefe", createdAt: "", ...x });
const asg = (x: Partial<WorkAssignment>): WorkAssignment => ({ id: "a", projectId: "p1", rubro: "carpinteria_madera", operatorId: "op-juan", date: "2026-10-16", plannedHours: 4, createdBy: "", createdAt: "", ...x });

describe("días laborales y capacidad", () => {
  it("sin dato: lunes a viernes con la jornada de Configuración", () => {
    expect(workDaysOf(juan)).toEqual([1, 2, 3, 4, 5]);
    expect(dayCapacity(juan, "2026-10-16", [], 8)).toMatchObject({ working: true, hours: 8 });
    expect(dayCapacity(juan, "2026-10-17", [], 8)).toMatchObject({ working: false, hours: 0, reason: "No trabaja los sábados (trabaja lunes a viernes)" });
  });
  it("días propios: Sofía no trabaja los viernes", () => {
    expect(dayCapacity(sofia, "2026-10-16", [], 8).working).toBe(false);
    expect(workDaysLabel([1, 2, 3, 4])).toBe("lunes, martes, miércoles y jueves");
    expect(workDaysLabel([6, 1, 2, 3, 4, 5])).toBe("lunes a sábado");
  });
  it("la excepción manda: trabaja el sábado 4 h, o no viene un día hábil", () => {
    expect(dayCapacity(juan, "2026-10-17", [exc({ hours: 4, note: "Entrega" })], 8)).toMatchObject({ working: true, hours: 4, reason: "Excepción: trabaja 4 h (Entrega)" });
    expect(dayCapacity(juan, "2026-10-17", [exc({})], 8).hours).toBe(8);
    expect(dayCapacity(juan, "2026-10-16", [exc({ date: "2026-10-16", works: false })], 8)).toMatchObject({ working: false, hours: 0 });
    // De otro operario no cuenta.
    expect(dayCapacity(juan, "2026-10-17", [exc({ operatorId: "op-diego" })], 8).working).toBe(false);
  });
  it("los días laborables de un rango respetan días y excepciones", () => {
    expect(operatorWorkdays(juan, [], "2026-10-16", "2026-10-20")).toEqual(["2026-10-16", "2026-10-19", "2026-10-20"]);
    expect(operatorWorkdays(juan, [exc({}), exc({ date: "2026-10-19", works: false })], "2026-10-16", "2026-10-20")).toEqual(["2026-10-16", "2026-10-17", "2026-10-20"]);
    expect(operatorWorkdays(sofia, [], "2026-10-15", "2026-10-19")).toEqual(["2026-10-15", "2026-10-19"]);
  });
  it("semana completa de lunes a domingo", () => {
    expect(fullWeek("2026-10-16")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });
  it("valida excepciones", () => {
    expect(exceptionError({ date: "", works: true })).toMatch(/fecha/);
    expect(exceptionError({ date: "2026-10-17", works: true, hours: 30 })).toMatch(/0 a 24/);
    expect(exceptionError({ date: "2026-10-17", works: false })).toBeNull();
  });
});

describe("celda del calendario", () => {
  it("6/8 h con un chip por proyecto (sumando sus asignaciones), uno al lado del otro", () => {
    const list = [asg({ id: "a1", plannedHours: 2 }), asg({ id: "a2", plannedHours: 2, rubro: "pintura" }), asg({ id: "a3", projectId: "p2", plannedHours: 2 })];
    const cell = calendarCell(juan, "2026-10-16", list, [], 8);
    expect(cell).toMatchObject({ planned: 6, over: false, overBy: 0 });
    expect(cell.capacity.hours).toBe(8);
    expect(cell.chips).toEqual([
      { projectId: "p1", hours: 4, assignmentIds: ["a1", "a2"] },
      { projectId: "p2", hours: 2, assignmentIds: ["a3"] },
    ]);
  });
  it("rojo si pasa la capacidad; un día no laborable con horas también", () => {
    expect(calendarCell(juan, "2026-10-16", [asg({ plannedHours: 10 })], [], 8)).toMatchObject({ over: true, overBy: 2 });
    const off = calendarCell(juan, "2026-10-16", [asg({ plannedHours: 3 })], [exc({ date: "2026-10-16", works: false })], 8);
    expect(off).toMatchObject({ over: true, overBy: 3 });
    expect(off.capacity.working).toBe(false);
  });
  it("cambiar la capacidad cambia la celda (valor derivado)", () => {
    const list = [asg({ date: "2026-10-17", plannedHours: 4 })];
    expect(calendarCell(juan, "2026-10-17", list, [], 8).over).toBe(true);
    expect(calendarCell(juan, "2026-10-17", list, [exc({ hours: 4 })], 8).over).toBe(false);
  });
  it("color estable por proyecto", () => {
    const ps = [{ id: "b", code: "P-2" }, { id: "a", code: "P-1" }];
    expect(projectColorIndex("a", ps)).toBe(0);
    expect(projectColorIndex("b", ps)).toBe(1);
  });
});

describe("la demo", () => {
  const NOW = new Date("2026-10-16T12:00:00");
  const seed = buildSeed(NOW);
  it("Sofía trabaja de lunes a jueves; Juan el sábado 4 h; Diego no viene un día y queda una alerta para reasignar", () => {
    expect(seed.operators.find((o) => o.id === "op-sofia")?.workDays).toEqual([1, 2, 3, 4]);
    expect(seed.dayExceptions.find((x) => x.operatorId === "op-juan")).toMatchObject({ date: "2026-10-17", works: true, hours: 4 });
    const diego = seed.dayExceptions.find((x) => x.operatorId === "op-diego")!;
    expect(diego.works).toBe(false);
    expect(seed.assignments.some((a) => a.operatorId === "op-diego" && a.date === diego.date)).toBe(true);
    const alerts = plantAlerts({ projects: seed.projects, assignments: seed.assignments, operators: seed.operators, settings: DEFAULT_SETTINGS, hoursPerDay: 9.5, today: "2026-10-16", dayExceptions: seed.dayExceptions });
    expect(alerts.find((a) => a.id === `overload:op-diego:${diego.date}`)?.title).toMatch(/Diego Sosa no trabaja el .* y tiene 8 h asignadas/);
  });
  it("las asignaciones futuras caen en días hábiles (hoy viernes: la próxima es el lunes)", () => {
    const future = seed.assignments.filter((a) => a.date > "2026-10-16");
    expect(future.length).toBeGreaterThan(0);
    for (const a of future) expect([0, 6]).not.toContain(new Date(`${a.date}T12:00:00`).getDay());
  });
  it("un fin de semana, el equipo de hoy tiene excepción para trabajar (Mi día no queda vacío)", () => {
    const sat = buildSeed(new Date("2026-10-17T12:00:00"));
    expect(sat.dayExceptions.some((x) => x.operatorId === "op-juan" && x.date === "2026-10-17" && x.works)).toBe(true);
  });
});
