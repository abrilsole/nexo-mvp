// Lote 5B — asignaciones del Jefe de planta y carga de horas por rubro, en un Postgres real (PGlite).
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { buildSeed, MAIN_DEMO_PROJECT_ID } from "@/lib/seed-data";
import { workspacePayload } from "@/lib/supabase/workspace";
import { asUser, createDb, errorAs, signUp } from "./harness";

let db: PGlite;
let org = "";
let laura = "";
let carla = ""; // Jefe de planta
let martin = ""; // Compras
let juan = ""; // Operario
let diego = ""; // Operario

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const rows = async (userId: string, sql: string, params: unknown[] = []) =>
  asUser(db, userId, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);
const call = async <T,>(userId: string, sql: string, params: unknown[] = []): Promise<T> => (await rows(userId, sql, params))[0]?.r as T;
const save = (userId: string, p: Record<string, unknown>) => call<string>(userId, "select planta_save_assignment($1::jsonb) as r", [JSON.stringify(p)]);
const saveError = (userId: string, p: Record<string, unknown>) => errorAs(db, userId, (tx) => tx.query("select planta_save_assignment($1::jsonb)", [JSON.stringify(p)]));

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

const MONEY = ["sales_price", "unit_cost", "total", "amount", "hourly_cost", "hourlyCost", "hourly_rate", "overtime_multiplier", "baseline"];

beforeAll(async () => {
  db = await createDb();
  laura = await signUp(db, "laura@demo.com", "Laura Gómez");
  org = (await db.query<{ organization_id: string }>("select organization_id from organization_members where user_id = $1", [laura])).rows[0].organization_id;
  const s = buildSeed(new Date());
  const payload = workspacePayload(org, { projects: s.projects, operators: s.operators, stock: s.stock, requests: [], assignments: [], settings: { ...DEFAULT_SETTINGS }, resolvedAlertIds: [] });
  await asUser(db, laura, (tx) => tx.query("select reset_workspace($1::jsonb)", [JSON.stringify(payload)]));
  const inv = (p: Record<string, unknown>) => asUser(db, laura, (tx) => tx.query("select admin_invite_member($1::jsonb)", [JSON.stringify(p)]));
  await inv({ email: "carla@demo.com", display_name: "Carla Sosa", role: "jefe_planta" });
  await inv({ email: "martin@demo.com", display_name: "Martín Ruiz", role: "compras" });
  await inv({ email: "juan@demo.com", display_name: "Juan Pérez", role: "operator", operator_id: "op-juan" });
  await inv({ email: "diego@demo.com", display_name: "Diego Sosa", role: "operator", operator_id: "op-diego" });
  carla = await signUp(db, "carla@demo.com", "Carla");
  martin = await signUp(db, "martin@demo.com", "Martín");
  juan = await signUp(db, "juan@demo.com", "Juan");
  diego = await signUp(db, "diego@demo.com", "Diego");
}, 120_000);

describe("asignaciones", () => {
  it("el Jefe de planta asigna: queda la asignación y el operario pasa al equipo del proyecto", async () => {
    await db.query("update projects set assigned_operator_ids = '{}' where organization_id = $1 and id = 'p-1045'", [org]);
    const id = await save(carla, { id: "asg-1", project_id: "p-1045", rubro: "carpinteria_madera", operator_id: "op-juan", date: daysAgo(3), planned_hours: 4 });
    expect(id).toBe("asg-1");
    expect(await rows(carla, "select id, planned_hours::text as h from work_assignments")).toEqual([{ id: "asg-1", h: "4" }]);
    const [{ ids }] = (await db.query<{ ids: string[] }>("select assigned_operator_ids as ids from projects where organization_id = $1 and id = 'p-1045'", [org])).rows;
    expect(ids).toEqual(["op-juan"]);
    // Editar: mismo id.
    await save(carla, { id: "asg-1", project_id: "p-1045", rubro: "carpinteria_madera", operator_id: "op-juan", date: daysAgo(3), planned_hours: 5 });
    expect(await rows(laura, "select planned_hours::text as h from work_assignments where id = 'asg-1'")).toEqual([{ h: "5" }]);
  });
  it("Administrativo también asigna", async () => {
    expect(await save(laura, { id: "asg-2", project_id: MAIN_DEMO_PROJECT_ID, rubro: "carpinteria_madera", operator_id: "op-diego", date: daysAgo(1), planned_hours: 8 })).toBe("asg-2");
  });
  it("valida proyecto, operario, rubro y horas", async () => {
    const base = { project_id: MAIN_DEMO_PROJECT_ID, rubro: "carpinteria_madera", operator_id: "op-juan", date: daysAgo(1), planned_hours: 4 };
    expect(await saveError(carla, { ...base, project_id: "p-0987" })).toMatch(/Aprobado e Instalación/); // cerrado
    expect(await saveError(carla, { ...base, project_id: "p-1056" })).toMatch(/Aprobado e Instalación/); // cotización
    expect(await saveError(carla, { ...base, operator_id: "op-nadie" })).toMatch(/operario activo/);
    expect(await saveError(carla, { ...base, planned_hours: 25 })).toMatch(/entre 0 y 24/);
    expect(await saveError(carla, { ...base, rubro: "no-existe" })).toMatch(/check/);
  });
  it("Compras y el Operario no asignan ni leen las asignaciones directo", async () => {
    const base = { project_id: MAIN_DEMO_PROJECT_ID, rubro: "carpinteria_madera", operator_id: "op-juan", date: daysAgo(1), planned_hours: 4 };
    expect(await saveError(martin, base)).toMatch(/Jefe de planta o un usuario Administrativo/);
    expect(await saveError(juan, base)).toMatch(/Jefe de planta o un usuario Administrativo/);
    expect(await rows(martin, "select * from work_assignments")).toHaveLength(0);
    expect(await rows(juan, "select * from work_assignments")).toHaveLength(0);
  });
  it("quitar una asignación la marca (no borra la fila) y deja de aparecer", async () => {
    await save(carla, { id: "asg-x", project_id: MAIN_DEMO_PROJECT_ID, rubro: "carpinteria_madera", operator_id: "op-juan", date: daysAgo(2), planned_hours: 2 });
    await asUser(db, carla, (tx) => tx.query("select planta_remove_assignment('asg-x')"));
    const [r] = (await db.query<{ removed: boolean }>("select removed_at is not null as removed from work_assignments where id = 'asg-x'")).rows;
    expect(r.removed).toBe(true);
    const ws = await call<{ assignments: { id: string }[] }>(carla, "select planta_workspace() as r");
    expect(ws.assignments.map((a) => a.id)).not.toContain("asg-x");
  });
});

describe("lo que lee cada rol", () => {
  it("Jefe de planta: asignaciones, horas estimadas por rubro y jornada, sin ningún importe", async () => {
    const ws = await call<{ assignments: unknown[]; budget_lines: { category: string; quantity: number }[]; hours_per_day: number }>(carla, "select planta_workspace() as r");
    expect(ws.assignments.length).toBeGreaterThan(0);
    expect(ws.budget_lines.length).toBeGreaterThan(0);
    expect(ws.budget_lines.every((l) => l.category === "labor")).toBe(true);
    expect(Number(ws.hours_per_day)).toBe(9.5);
    const keys = keysDeep(ws);
    for (const k of MONEY) expect(keys.has(k), k).toBe(false);
  });
  it("Operario: solo sus asignaciones, los rubros de sus proyectos y su jornada; nada económico", async () => {
    await save(carla, { id: "asg-j", project_id: MAIN_DEMO_PROJECT_ID, rubro: "carpinteria_madera", operator_id: "op-juan", date: daysAgo(1), planned_hours: 4 });
    const ws = await call<{ assignments: { id: string; operator_id: string }[]; project_rubros: { rubro: string }[]; hours_per_day: number }>(juan, "select taller_workspace() as r");
    expect(ws.assignments.every((a) => a.operator_id === "op-juan")).toBe(true);
    expect(ws.assignments.map((a) => a.id)).toContain("asg-j");
    expect(ws.assignments.map((a) => a.id)).not.toContain("asg-2"); // de Diego
    expect(ws.project_rubros.map((r) => r.rubro)).toContain("carpinteria_madera");
    const text = JSON.stringify(ws);
    for (const k of ["hourly_rate", "overtime_multiplier", "labor_valuation", "planned_cost"]) expect(text).not.toContain(k);
    // Los campos de plata que ya existían llegan en 0 (Lote 2): ningún importe real.
    expect(text).not.toMatch(/"(unit_cost|amount|sales_price|hourly_cost|hourlyCost)":[1-9]/);
  });
});

describe("carga de horas por rubro", () => {
  it("el operario confirma su asignación: queda con rubro, asignación y el costo del día (calculado en el servidor)", async () => {
    await asUser(db, juan, (tx) =>
      tx.query("select taller_log_hours($1::jsonb)", [
        JSON.stringify({ id: "h-asg-j", project_id: MAIN_DEMO_PROJECT_ID, date: daysAgo(1), hours: 9, work_type: "Carpintería madera", rubro: "carpinteria_madera", assignment_id: "asg-j" }),
      ]),
    );
    const [e] = (await db.query<{ rubro: string; assignment_id: string; amount: string }>("select rubro, assignment_id, amount::text from actual_entries where id = 'h-asg-j'")).rows;
    expect({ ...e, amount: Number(e.amount) }).toEqual({ rubro: "carpinteria_madera", assignment_id: "asg-j", amount: 135_000 });
  });
  it("no puede usar la asignación de otro ni un rubro que no existe; el tope es 24 h por día", async () => {
    const log = (p: Record<string, unknown>) =>
      errorAs(db, juan, (tx) => tx.query("select taller_log_hours($1::jsonb)", [JSON.stringify({ project_id: MAIN_DEMO_PROJECT_ID, date: daysAgo(4), hours: 1, work_type: "x", ...p })]));
    expect(await log({ assignment_id: "asg-2" })).toMatch(/no es tuya/);
    expect(await log({ rubro: "no-existe" })).toMatch(/check/);
    expect(await log({ hours: 20, date: daysAgo(5) })).toBeNull(); // más que la jornada: se guarda (el aviso es en pantalla)
    expect(await log({ hours: 5, date: daysAgo(5) })).toMatch(/24 h/);
  });
  it("Diego no ve las horas ni las asignaciones de Juan", async () => {
    const ws = await call<{ actual_entries: { id: string }[]; assignments: { id: string }[] }>(diego, "select taller_workspace() as r");
    expect(ws.actual_entries.map((e) => e.id)).not.toContain("h-asg-j");
    expect(ws.assignments.map((a) => a.id)).not.toContain("asg-j");
  });
});
