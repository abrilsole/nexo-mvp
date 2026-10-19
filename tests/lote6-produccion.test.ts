// Lote 6 — productos, estado de producción, asignaciones por producto + rubro, desvío, alertas, "Mi día" y dashboard.
// Sobre el seed real: el proyecto estrella (10 mesas + 100 sillas), un proyecto atrasado a propósito y uno en riesgo.
import { describe, expect, it } from "vitest";
import type { Project, WorkAssignment } from "@/types";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { buildSeed, MAIN_DEMO_PROJECT_ID, STAR_PROJECT_ID } from "@/lib/seed-data";
import {
  addDays,
  assignmentError,
  dayLoad,
  exceeds,
  operatorVerdict,
  pendingAssignments,
  plantAlerts,
  productRubroHours,
  thresholdOf,
  workdaysBetween,
  workWeek,
} from "@/lib/plant";
import { productInputError, productStatus, projectProduction, scheduleSignal, unitProgress } from "@/lib/production";
import { hoursReport } from "@/lib/hours-report";
import { myDay } from "@/lib/my-day";
import { marginSummary, projectSignals, rubroVariance, weekHours } from "@/lib/dashboard";
import { checkHours } from "@/lib/project-rules";
import * as ops from "@/lib/project-operations";

const NOW = new Date("2026-10-15T12:00:00"); // jueves
const TODAY = "2026-10-15";
const seed = buildSeed(NOW);
const t = thresholdOf(DEFAULT_SETTINGS);
const star = () => seed.projects.find((p) => p.id === STAR_PROJECT_ID)!;
const ctx: ops.Ctx = { actor: "Laura Gómez", now: NOW.toISOString(), role: "owner" };

describe("estado del producto y del proyecto (funciones puras)", () => {
  const item = { quantity: 100, completedUnits: 0 };
  it("Pendiente = 0 terminadas y sin horas · En producción = horas o algunas terminadas · Terminado = todas", () => {
    expect(productStatus(item, 0)).toBe("pending");
    expect(productStatus(item, 3)).toBe("in_production");
    expect(productStatus({ ...item, completedUnits: 40 }, 0)).toBe("in_production");
    expect(productStatus({ ...item, completedUnits: 100 }, 0)).toBe("done");
    expect(unitProgress({ ...item, completedUnits: 40 })).toBe(0.4);
  });
  it("el proyecto estrella: mesas terminadas (10/10), sillas en producción (40/100) → proyecto en producción", () => {
    const prod = projectProduction(star());
    expect(prod.products.map((p) => [p.item.name, p.status, `${p.item.completedUnits}/${p.item.quantity}`])).toEqual([
      ["Mesa de comedor", "done", "10/10"],
      ["Silla apilable", "in_production", "40/100"],
    ]);
    expect(prod.status).toBe("in_production");
    // Avance ponderado por horas estimadas: mesas 86 h al 100 %, sillas 300 h al 40 %.
    expect(prod.progress).toBeCloseTo((86 * 1 + 300 * 0.4) / 386, 3);
  });
  it("todas las unidades terminadas → proyecto terminado; sin horas ni unidades → pendiente", () => {
    const p = star();
    const done: Project = { ...p, items: p.items.map((i) => ({ ...i, completedUnits: i.quantity })) };
    expect(projectProduction(done).status).toBe("done");
    const fresh: Project = { ...p, actualEntries: [], items: p.items.map((i) => ({ ...i, completedUnits: 0 })) };
    expect(projectProduction(fresh).status).toBe("pending");
  });
  it("valida un producto: nombre, cantidad entera, al menos un rubro con horas y operarios, sin repetir", () => {
    const ok = { name: "Silla", quantity: 100, rubros: [{ rubro: "carpinteria_madera" as const, hours: 200, workers: 2 }] };
    expect(productInputError(ok)).toBeNull();
    expect(productInputError({ ...ok, rubros: [] })).toMatch(/al menos un rubro/);
    expect(productInputError({ ...ok, quantity: 1.5 })).toMatch(/entero/);
    expect(productInputError({ ...ok, rubros: [...ok.rubros, ...ok.rubros] })).toMatch(/repetido/);
    expect(productInputError({ ...ok, rubros: [{ rubro: "transporte", hours: 1, workers: 1 }] })).toMatch(/importe/);
    expect(productInputError(ok, 120)).toMatch(/no puede ser menor/);
  });
});

describe("semáforo de entrega", () => {
  const signals = projectSignals(seed.projects, TODAY, DEFAULT_SETTINGS.dueSoonDays);
  it("P-1047 está atrasado a propósito; P-1039 en riesgo (entrega en 3 días); el resto en tiempo", () => {
    expect(signals.late.map((s) => s.project.code)).toEqual(["P-1047"]);
    expect(signals.at_risk.map((s) => s.project.code)).toContain("P-1039");
    expect(signals.on_time.map((s) => s.project.code)).toContain("P-1058");
    expect(signals.late[0].schedule.reason).toMatch(/venció hace 2 días/);
  });
  it("no hay proyectos en curso con la entrega vencida salvo el atrasado a propósito", () => {
    const live = seed.projects.filter((p) => !p.isClosed && p.status !== "quotation" && p.dueDate < TODAY);
    expect(live.map((p) => p.code)).toEqual(["P-1047"]);
  });
  it("el avance cambia el semáforo: terminar todo lo deja en tiempo", () => {
    const p = seed.projects.find((x) => x.code === "P-1047")!;
    const done = { ...p, items: p.items.map((i) => ({ ...i, completedUnits: i.quantity })) };
    expect(scheduleSignal(done, TODAY, 5).signal).toBe("on_time");
  });
});

describe("asignaciones por producto + rubro", () => {
  it("validan producto y rubro del producto", () => {
    const c = { projects: seed.projects, operators: seed.operators };
    const ok = { projectId: STAR_PROJECT_ID, itemId: "itm-sillas", rubro: "embalaje" as const, operatorId: "op-lucia", date: TODAY, plannedHours: 6 };
    expect(assignmentError(ok, c)).toBeNull();
    expect(assignmentError({ ...ok, itemId: "nada" }, c)).toMatch(/producto/);
    expect(assignmentError({ ...ok, rubro: "vidrios" }, c)).toMatch(/no tiene ese rubro/);
    expect(assignmentError({ ...ok, projectId: "p-1056", itemId: "itm-1056-stand" }, c)).toMatch(/Aprobado e Instalación/);
    expect(assignmentError({ ...ok, plannedHours: 25 }, c)).toMatch(/24 h/);
  });
  it("pendientes de asignar: producto + rubro con menos operarios que los pedidos, el estrella primero", () => {
    const pending = pendingAssignments(seed.projects, seed.assignments, TODAY);
    expect(pending[0]).toMatchObject({ projectId: STAR_PROJECT_ID, itemName: "Silla apilable", rubro: "embalaje", workers: 1, assigned: 0 });
    expect(pending.map((p) => p.dueDate)).toEqual([...pending.map((p) => p.dueDate)].sort());
    expect(pending.some((p) => p.projectId === "p-1056")).toBe(false); // cotización
    expect(pending.some((p) => p.itemId === "itm-mesas")).toBe(false); // terminado
  });
  it("cuando se asigna todo, la cola queda vacía (valor derivado)", () => {
    const pending = pendingAssignments(seed.projects, seed.assignments, TODAY);
    const extra: WorkAssignment[] = pending.flatMap((r, i) =>
      Array.from({ length: r.missing }, (_, k) => ({
        id: `x-${i}-${k}`, projectId: r.projectId, itemId: r.itemId, rubro: r.rubro, operatorId: `op-extra-${k}`, date: addDays(TODAY, 1), plannedHours: 8, createdBy: "", createdAt: "",
      })),
    );
    expect(pendingAssignments(seed.projects, [...seed.assignments, ...extra], TODAY)).toEqual([]);
  });
  it("días hábiles para asignar en bloque y carga del día con la jornada", () => {
    expect(workdaysBetween("2026-10-15", "2026-10-20")).toEqual(["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
    expect(workWeek(TODAY)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(dayLoad(seed.assignments, "op-juan", TODAY, 9.5)).toMatchObject({ planned: 8, overloaded: false });
  });
});

describe("desvío por producto + rubro", () => {
  it("umbral: 25 % o 2 h, lo que ocurra primero", () => {
    expect(exceeds(8, 9.5, t)).toBe(false);
    expect(exceeds(8, 10, t)).toBe(true);
    expect(exceeds(2, 2.6, t)).toBe(true);
    expect(operatorVerdict(30, 44)).toBe("over");
    expect(operatorVerdict(30, 30)).toBe("met");
    expect(operatorVerdict(24, 22)).toBe("short");
    expect(operatorVerdict(0, 0)).toBe("not_started");
  });
  it("mesas · carpintería: se estimaron 60 h y se cargaron 74 h; Juan se pasó 14 h y Diego cumplió", () => {
    const r = productRubroHours(star(), seed.assignments, t, TODAY).find((x) => x.itemId === "itm-mesas" && x.rubro === "carpinteria_madera")!;
    expect(r).toMatchObject({ estimated: 60, actual: 74, over: 14, flagged: true });
    expect(r.operators.find((o) => o.operatorId === "op-juan")).toMatchObject({ planned: 30, actual: 44, diff: 14, verdict: "over" });
    expect(r.operators.find((o) => o.operatorId === "op-diego")).toMatchObject({ planned: 30, actual: 30, verdict: "met" });
    expect(r.records.reduce((s, x) => s + x.hours, 0)).toBe(74); // cada hora sale de un registro
  });
  it("no hay horas sin producto ni rubro en todo el seed, y toda hora tiene su asignación", () => {
    const labor = seed.projects.flatMap((p) => p.actualEntries.filter((e) => e.type === "labor"));
    expect(labor.length).toBeGreaterThan(0);
    const ids = new Set(seed.assignments.map((a) => a.id));
    expect(labor.every((e) => e.rubro && e.itemId && e.assignmentId && ids.has(e.assignmentId))).toBe(true);
  });
});

describe("alertas de desvío (Administrativo y resumen del Jefe de planta)", () => {
  const alerts = plantAlerts({ projects: seed.projects, assignments: seed.assignments, operators: seed.operators, settings: DEFAULT_SETTINGS, hoursPerDay: 9.5, today: TODAY });
  it("una sola alerta de horas en la demo: proyecto, producto, rubro, operario y desvío", () => {
    const hours = alerts.filter((a) => a.kind === "hours");
    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ projectCode: "P-1058" });
    expect(hours[0].title).toBe("Mesa de comedor · Carpintería madera: 14 h por encima de lo estimado");
    expect(hours[0].message).toMatch(/Juan Pérez 44 h \(\+14 h sobre lo asignado\)/);
    expect(hours[0].records?.length).toBeGreaterThan(0);
  });
  it("cargar horas por encima de la estimación genera la alerta (valor derivado)", () => {
    const p = seed.projects.find((x) => x.id === MAIN_DEMO_PROJECT_ID)!;
    const a: WorkAssignment = { id: "a-new", projectId: p.id, itemId: "itm-mostrador", rubro: "carpinteria_madera", operatorId: "op-juan", date: TODAY, plannedHours: 8, createdBy: "", createdAt: "" };
    const before = plantAlerts({ projects: seed.projects, assignments: [...seed.assignments, a], operators: seed.operators, settings: DEFAULT_SETTINGS, hoursPerDay: 9.5, today: TODAY });
    expect(before.some((x) => x.projectId === p.id && x.kind === "hours")).toBe(false);
    const after = ops.logHours(p, seed.operators, [a], { assignmentId: "a-new", hours: 8 }, DEFAULT_SETTINGS, ctx); // 28 + 8 = 36 > 30
    const projects = seed.projects.map((x) => (x.id === p.id ? after : x));
    const alertsAfter = plantAlerts({ projects, assignments: [...seed.assignments, a], operators: seed.operators, settings: DEFAULT_SETTINGS, hoursPerDay: 9.5, today: TODAY });
    expect(alertsAfter.find((x) => x.projectId === p.id && x.kind === "hours")?.title).toMatch(/Mostrador de atención · Carpintería madera: 6 h por encima/);
  });
  it("ninguna alerta de planta lleva importes", () => {
    expect(alerts.every((a) => a.impactAmount === undefined && !/\$/.test(a.message + a.title))).toBe(true);
  });
});

describe("Mi día del operario", () => {
  it("hoy Juan tiene solo las sillas del proyecto estrella: proyecto, producto, rubro y horas estimadas", () => {
    const day = myDay(seed.projects, seed.assignments, "op-juan", TODAY);
    expect(day.items.map((i) => [i.project.code, i.item?.name, i.assignment.rubro, i.assignment.plannedHours, i.done])).toEqual([
      ["P-1058", "Silla apilable", "carpinteria_madera", 8, false],
    ]);
  });
  it("una carga parcial suma al día sin completar la asignación", () => {
    const item = myDay(seed.projects, seed.assignments, "op-juan", TODAY).items[0];
    const juan: ops.Ctx = { ...ctx, role: "operator", operatorId: "op-juan", actor: "Juan Pérez" };
    const after = ops.logHours(item.project, seed.operators, seed.assignments, { assignmentId: item.assignment.id, hours: 7.5 }, DEFAULT_SETTINGS, juan);
    const day = myDay(seed.projects.map((p) => (p.id === after.id ? after : p)), seed.assignments, "op-juan", TODAY);
    expect(day.items[0]).toMatchObject({ logged: 7.5, done: false });
    expect(day.total).toBe(7.5);
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

describe("Horas del Administrativo: estimadas (productos) vs reales", () => {
  const report = hoursReport({ projects: seed.projects, assignments: seed.assignments, operators: seed.operators, today: TODAY, threshold: t });
  it("por proyecto: estimadas = suma de producto + rubro, con la diferencia y el %", () => {
    const s = report.byProject.find((r) => r.key === STAR_PROJECT_ID)!;
    expect(s.estimated).toBe(386);
    expect(s.actual).toBe(74 + 20 + 6 + 46 + 24);
    const main = report.byProject.find((r) => r.key === MAIN_DEMO_PROJECT_ID)!;
    expect(main).toMatchObject({ estimated: 100, actual: 74, flagged: false });
  });
  it("por operario: previstas en sus asignaciones vs cargadas, con el costo de cada registro", () => {
    const juan = report.byOperator.find((r) => r.key === "op-juan")!;
    expect(juan.actual).toBeGreaterThan(juan.estimated); // se pasó en las mesas
    expect(juan.actualCost).toBeGreaterThan(0);
  });
});

describe("dashboard del Administrativo (agregados)", () => {
  it("horas de la semana: lo previsto hasta hoy contra lo cargado, por operario", () => {
    const w = weekHours(seed.projects, seed.assignments, seed.operators, TODAY);
    expect(w.from).toBe("2026-10-12");
    expect(w.operators.reduce((s, o) => s + o.planned, 0)).toBeCloseTo(w.planned);
    expect(w.operators.every((o) => o.verdict === (o.actual > o.planned ? "over" : o.actual < o.planned ? "short" : o.planned > 0 ? "met" : "not_started"))).toBe(true);
  });
  it("margen: esperado y proyectado de los proyectos en curso; el real solo de los cerrados", () => {
    const m = marginSummary(seed.projects);
    expect(m.rows.every((r) => !r.project.isClosed && r.project.status !== "quotation")).toBe(true);
    expect(m.closed.every((c) => c.project.isClosed)).toBe(true);
    expect(m.closed.length).toBe(4);
    expect(m.expected).not.toBeNull();
    expect(m.rubros.every((r) => r.over > 0)).toBe(true);
  });
  it("desvío por rubro: real = consumo + desperdicio + horas + costos del rubro, contra el presupuesto del rubro", () => {
    const rows = rubroVariance(star());
    const carp = rows.find((r) => r.rubro === "carpinteria_madera")!;
    expect(carp.budget).toBe(20 * 95_000 + 200 * 1_000 + 280 * 15_000);
    expect(carp.actual).toBeGreaterThan(0);
  });
});
