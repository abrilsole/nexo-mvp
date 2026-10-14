// Lote 3 — capacidad por operario y horas extra (funciones puras). En el Lote 4 la cotización dejó de
// elegir operarios con nombre; estas funciones quedan para el jefe de planta (Lote 5).
import { describe, expect, it } from "vitest";
import type { Operator } from "@/types";
import {
  hoursAssignedElsewhere,
  laborAmount,
  operatorCapacity,
  planLabor,
  productionWindowDays,
  splitHoursEvenly,
  splitOvertime,
  workingDaysBetween,
  type PlanContext,
} from "@/lib/capacity";
import { line, project } from "./helpers";

const op = (id: string, name: string, role: string, hourlyCost: number): Operator => ({
  id,
  name,
  role,
  hourlyCost,
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
});

const JUAN = op("op-juan", "Juan Pérez", "Carpintería", 10_000);
const ANA = op("op-ana", "Ana Gómez", "Carpintería", 12_000);
const SIN_COSTO = op("op-x", "Pedro Sin Costo", "Lustre", 0);

// Lunes 5/10/2026 → viernes 16/10/2026 = 10 días hábiles.
const ctx = (extra: Partial<PlanContext> = {}): PlanContext => ({
  operators: [JUAN, ANA, SIN_COSTO],
  projects: [],
  startDate: "2026-10-05",
  deadline: "2026-10-16",
  installationDays: 0,
  hoursPerDay: 8,
  overtimeMultiplier: 2,
  today: "2026-10-05",
  ...extra,
});

describe("días hábiles hasta el plazo", () => {
  it("cuenta lunes a viernes, con las dos puntas", () => {
    expect(workingDaysBetween("2026-10-05", "2026-10-16")).toBe(10);
    expect(workingDaysBetween("2026-10-09", "2026-10-12")).toBe(2); // viernes y lunes
    expect(workingDaysBetween("2026-10-10", "2026-10-11")).toBe(0); // fin de semana
    expect(workingDaysBetween("2026-10-16", "2026-10-05")).toBe(0); // plazo antes del inicio
  });
  it("para producir se descuentan los días de instalación", () => {
    expect(productionWindowDays("2026-10-05", "2026-10-16", 2)).toBe(8);
    expect(productionWindowDays("2026-10-05", "2026-10-06", 5)).toBe(0);
  });
});

describe("capacidad de un operario", () => {
  it("jornada × días hábiles − horas ya asignadas", () => {
    expect(operatorCapacity({ hoursPerDay: 8, workingDays: 10, assignedHours: 30 })).toBe(50);
    expect(operatorCapacity({ hoursPerDay: 8, workingDays: 2, assignedHours: 30 })).toBe(0);
  });
  it("lo que no entra es hora extra", () => {
    expect(splitOvertime(60, 80)).toEqual({ normalHours: 60, overtimeHours: 0 });
    expect(splitOvertime(100, 80)).toEqual({ normalHours: 80, overtimeHours: 20 });
  });
  it("reparte las horas del rol en partes iguales y suma exacto", () => {
    expect(splitHoursEvenly(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(splitHoursEvenly(10, 0)).toEqual([]);
  });
});

describe("horas asignadas en otros proyectos activos", () => {
  const other = project({
    id: "p-otro",
    status: "production",
    startDate: "2026-10-05",
    dueDate: "2026-10-30", // 20 días hábiles
    budgetLines: [line("labor", 40, 10_000, { operatorId: "op-juan" })],
  });
  it("cuenta la parte de lo pendiente que cae en el período", () => {
    // 40 h en 20 días hábiles → 2 h por día; el período tiene 10 → 20 h.
    expect(hoursAssignedElsewhere("op-juan", [other], { from: "2026-10-05", to: "2026-10-16", today: "2026-10-05" })).toBe(20);
  });
  it("descuenta lo que el operario ya registró en ese proyecto", () => {
    const withHours = {
      ...other,
      actualEntries: [
        {
          id: "h1", projectId: "p-otro", date: "2026-10-05", type: "labor" as const, category: "labor" as const, description: "h", amount: 200_000,
          createdBy: "t", createdAt: "x", operatorId: "op-juan", labor: { role: "Carpintería", hours: 20, hourlyCost: 10_000 },
        },
      ],
    };
    expect(hoursAssignedElsewhere("op-juan", [withHours], { from: "2026-10-05", to: "2026-10-16", today: "2026-10-05" })).toBe(10);
  });
  it("no cuenta cotizaciones, finalizados, otros operarios ni el mismo proyecto", () => {
    const period = { from: "2026-10-05", to: "2026-10-16", today: "2026-10-05" };
    expect(hoursAssignedElsewhere("op-juan", [{ ...other, status: "quotation" }], period)).toBe(0);
    expect(hoursAssignedElsewhere("op-juan", [{ ...other, status: "completed" }], period)).toBe(0);
    expect(hoursAssignedElsewhere("op-ana", [other], period)).toBe(0);
    expect(hoursAssignedElsewhere("op-juan", [other], { ...period, excludeProjectId: "p-otro" })).toBe(0);
  });
});

describe("plan de mano de obra del Cotizador", () => {
  it("operario con capacidad suficiente: todo en horario normal", () => {
    const [role] = planLabor([{ role: "Carpintería", hours: 60, operatorIds: ["op-juan"] }], ctx()).roles;
    const [juan] = role.operators;
    expect(juan.availableHours).toBe(80);
    expect(juan).toMatchObject({ normalHours: 60, overtimeHours: 0, normalCost: 600_000, overtimeCost: 0, total: 600_000 });
    expect(role.shortage).toBe(false);
  });

  it("operario con horas extra: la diferencia se paga con el costo recargado", () => {
    const [role] = planLabor([{ role: "Carpintería", hours: 100, operatorIds: ["op-juan"] }], ctx()).roles;
    const [juan] = role.operators;
    expect(juan).toMatchObject({ normalHours: 80, overtimeHours: 20, overtimeRate: 20_000, normalCost: 800_000, overtimeCost: 400_000, total: 1_200_000 });
    expect(role.shortage).toBe(true);
    expect(role.availableHours).toBe(80);
  });

  it("las horas ya asignadas en otro proyecto activo reducen la disponibilidad", () => {
    const other = project({
      id: "p-otro",
      status: "purchasing",
      startDate: "2026-10-05",
      dueDate: "2026-10-16",
      budgetLines: [line("labor", 30, 10_000, { operatorId: "op-juan" })],
    });
    const [juan] = planLabor([{ role: "Carpintería", hours: 60, operatorIds: ["op-juan"] }], ctx({ projects: [other] })).roles[0].operators;
    expect(juan.assignedElsewhere).toBe(30);
    expect(juan.availableHours).toBe(50);
    expect(juan.overtimeHours).toBe(10);
  });

  it("operario sin costo por hora: se marca y su costo da 0", () => {
    const [p] = planLabor([{ role: "Lustre", hours: 10, operatorIds: ["op-x"] }], ctx()).roles[0].operators;
    expect(p.missingCost).toBe(true);
    expect(p.total).toBe(0);
  });

  it("multiplicador distinto de 2 (1,5 para días hábiles)", () => {
    const [juan] = planLabor([{ role: "Carpintería", hours: 100, operatorIds: ["op-juan"] }], ctx({ overtimeMultiplier: 1.5 })).roles[0].operators;
    expect(juan.overtimeRate).toBe(15_000);
    expect(juan.overtimeCost).toBe(300_000);
    expect(juan.total).toBe(1_100_000);
    expect(laborAmount({ normalHours: 0, overtimeHours: 4, hourlyCost: 10_000, multiplier: 3 }).overtimeCost).toBe(120_000);
  });

  it("el costo cambia cuando cambian las horas o el plazo", () => {
    const cost = (hours: number, deadline: string | null) =>
      planLabor([{ role: "Carpintería", hours, operatorIds: ["op-juan"] }], ctx({ deadline })).roles[0].total;
    expect(cost(60, "2026-10-16")).toBe(600_000);
    expect(cost(100, "2026-10-16")).toBe(1_200_000); // más horas → horas extra
    expect(cost(100, "2026-10-23")).toBe(1_000_000); // plazo más largo → entra todo en horario normal
    expect(cost(100, "2026-10-09")).toBe(1_600_000); // plazo más corto → 40 normales + 60 extra
    expect(cost(100, null)).toBe(1_000_000); // sin plazo no se calculan horas extra
  });

  it("dos operarios del mismo rol se reparten las horas, cada uno con su costo", () => {
    const role = planLabor([{ role: "Carpintería", hours: 120, operatorIds: ["op-juan", "op-ana"] }], ctx()).roles[0];
    expect(role.operators.map((o) => o.hours)).toEqual([60, 60]);
    expect(role.total).toBe(60 * 10_000 + 60 * 12_000);
    expect(role.shortage).toBe(false);
  });
});
