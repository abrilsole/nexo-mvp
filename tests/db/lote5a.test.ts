// Lote 5A — cuatro roles, usuarios y precios con vigencia, probados en un Postgres real (PGlite).
// La base arranca con las migraciones ANTERIORES al Lote 5A y la demo cargada; después se migra
// (así se prueba que la migración no cambia ningún importe) y se invitan los usuarios de cada rol.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { buildSeed, MAIN_DEMO_PROJECT_ID } from "@/lib/seed-data";
import { workspacePayload } from "@/lib/supabase/workspace";
import { asUser, assignFor, createDb, errorAs, migrateFrom, signUp } from "./harness";

const LOTE_5A = "20261016";
const APPROVED = "p-1051";
const QUOTATION = "p-1056";
const CLOSED = "p-0987";

let db: PGlite;
let org = "";
let laura = ""; // Administrativo (dueña)
let sofia = ""; // Administrativo invitado
let martin = ""; // Compras
let carla = ""; // Jefe de planta
let juan = ""; // Operario
let outsider = ""; // Administrativo de otra empresa
let before: Record<string, string> = {};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const rows = async (userId: string, sql: string, params: unknown[] = []) =>
  asUser(db, userId, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);

const call = async <T,>(userId: string, sql: string, params: unknown[] = []): Promise<T> => (await rows(userId, sql, params))[0]?.r as T;

/** Todas las claves de un JSON, a cualquier profundidad. */
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

/** Importes de la empresa: lo que la migración NO puede cambiar. */
async function amounts(): Promise<Record<string, string>> {
  const q = async (sql: string) => String((await db.query<{ v: string }>(sql, [org])).rows[0].v);
  return {
    sales: await q("select coalesce(sum(sales_price), 0)::text as v from projects where organization_id = $1"),
    budget: await q("select coalesce(sum(total), 0)::text || '/' || coalesce(sum(unit_cost), 0)::text as v from budget_lines where organization_id = $1"),
    actual: await q("select coalesce(sum(amount), 0)::text as v from actual_entries where organization_id = $1"),
    purchases: await q("select coalesce(sum(total), 0)::text as v from purchase_entries where organization_id = $1"),
    usages: await q("select coalesce(sum(unit_cost * quantity_consumed), 0)::text as v from material_usages where organization_id = $1"),
    lots: await q("select coalesce(sum(unit_cost), 0)::text as v from stock_lots where organization_id = $1"),
    operators: await q("select string_agg(id || '=' || hourly_cost, ',' order by id) as v from operators where organization_id = $1"),
    rates: await q("select string_agg(id || '=' || hourly_rate, ',' order by id) as v from hour_rates where organization_id = $1"),
    baseline: await q("select coalesce(sum((baseline ->> 'budgetTotal')::numeric), 0)::text as v from projects where organization_id = $1"),
  };
}

async function invite(by: string, p: Record<string, unknown>) {
  return call<string>(by, "select admin_invite_member($1::jsonb) as r", [JSON.stringify(p)]);
}

beforeAll(async () => {
  db = await createDb({ before: LOTE_5A });
  laura = await signUp(db, "laura@demo.com", "Laura Gómez");
  org = (await db.query<{ organization_id: string }>("select organization_id from organization_members where user_id = $1", [laura])).rows[0].organization_id;
  const s = buildSeed(new Date());
  const payload = workspacePayload(org, { projects: s.projects, operators: s.operators, stock: s.stock, requests: [], assignments: [], orders: [], settings: { ...DEFAULT_SETTINGS }, resolvedAlertIds: [] });
  await asUser(db, laura, (tx) => tx.query("select reset_workspace($1::jsonb)", [JSON.stringify(payload)]));
  await db.query("insert into cost_settings (organization_id, overtime_multiplier) values ($1, 2)", [org]);
  await db.query(
    "insert into hour_rates (organization_id, id, name, hourly_rate, kind, position) values ($1, 'labor', 'Mano de obra', 19000, 'labor', 0), ($1, 'design', 'Diseño', 27000, 'design', 1), ($1, 'admin', 'Administración', 27000, 'admin', 2)",
    [org],
  );
  await db.query("update operators set email = 'juan@demo.com' where organization_id = $1 and id = 'op-juan'", [org]);
  juan = await signUp(db, "juan@demo.com", "Juan");
  before = await amounts();

  await migrateFrom(db, LOTE_5A);

  await invite(laura, { email: "sofia@demo.com", display_name: "Sofía Díaz", role: "member" });
  await invite(laura, { email: "Martin@Demo.com", display_name: "Martín Ruiz", role: "compras" });
  await invite(laura, { email: "carla@demo.com", display_name: "Carla Sosa", role: "jefe_planta" });
  sofia = await signUp(db, "sofia@demo.com", "Sofía");
  martin = await signUp(db, "martin@demo.com", "Martín");
  carla = await signUp(db, "carla@demo.com", "Carla");
  outsider = await signUp(db, "otra@empresa.com", "Otra Empresa");
}, 120_000);

describe("la migración no cambia ningún importe", () => {
  it("precios de venta, costo presupuestado, costos reales, compras, stock, tarifas y operarios quedan iguales", async () => {
    expect(await amounts()).toEqual(before);
  });
  it("cada tarifa, multiplicador y costo por hora queda en el historial con el mismo valor, también para fechas viejas", async () => {
    const check = async (kind: string, subject: string, expected: number) => {
      for (const date of [daysAgo(0), daysAgo(400), "2020-01-01"]) {
        const [{ v }] = (await db.query<{ v: string }>("select private.value_at($1, $2, $3, $4::date)::text as v", [org, kind, subject, date])).rows;
        expect(Number(v), `${kind} ${subject} ${date}`).toBe(expected);
      }
    };
    await check("hour_rate", "labor", 19_000);
    await check("hour_rate", "design", 27_000);
    await check("overtime_multiplier", "default", 2);
    await check("operator_cost", "op-juan", 15_000);
  });
});

describe("usuarios: invitación, rol, baja", () => {
  it("cada invitado entra a la empresa con su rol (el mail no distingue mayúsculas)", async () => {
    const r = (await db.query<{ user_id: string; role: string }>("select user_id, role from organization_members where organization_id = $1", [org])).rows;
    const roleOf = (u: string) => r.find((x) => x.user_id === u)?.role;
    expect([roleOf(laura), roleOf(sofia), roleOf(martin), roleOf(carla), roleOf(juan)]).toEqual(["owner", "member", "compras", "jefe_planta", "operator"]);
    const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from member_invitations where organization_id = $1 and accepted_at is null", [org])).rows;
    expect(n).toBe(0);
  });
  it("Administrativo ve los usuarios con su mail; el resto no puede", async () => {
    const list = await call<{ members: { email: string; role: string; is_self: boolean }[] }>(laura, "select admin_members() as r");
    expect(list.members.map((m) => m.email).sort()).toEqual(["carla@demo.com", "juan@demo.com", "laura@demo.com", "martin@demo.com", "sofia@demo.com"]);
    expect(list.members.find((m) => m.is_self)?.email).toBe("laura@demo.com");
    for (const u of [martin, carla, juan]) expect(await errorAs(db, u, (tx) => tx.query("select admin_members()"))).toMatch(/Administrativo/);
  });
  it("un operario se invita vinculado a una persona de Operarios sin cuenta", async () => {
    expect(await errorAs(db, laura, (tx) => tx.query("select admin_invite_member($1::jsonb)", [JSON.stringify({ email: "x@demo.com", display_name: "Xavier", role: "operator" })]))).toMatch(
      /operario activo/,
    );
    expect(
      await errorAs(db, laura, (tx) =>
        tx.query("select admin_invite_member($1::jsonb)", [JSON.stringify({ email: "x@demo.com", display_name: "Xavier", role: "operator", operator_id: "op-juan" })]),
      ),
    ).toMatch(/operario activo/); // Juan ya tiene cuenta
    expect(await invite(laura, { email: "diego@demo.com", display_name: "Diego Sosa", role: "operator", operator_id: "op-diego" })).toBeTruthy();
    const diego = await signUp(db, "diego@demo.com", "Diego");
    const [op] = (await db.query<{ user_id: string }>("select user_id from operators where organization_id = $1 and id = 'op-diego'", [org])).rows;
    expect(op.user_id).toBe(diego);
    const [{ ws }] = await rows(diego, "select taller_workspace() as ws");
    expect((ws as { status: string }).status).toBe("active");
  });
  it("valida mail, nombre y rol; un mail de la empresa no se invita dos veces", async () => {
    const err = (p: Record<string, unknown>) => errorAs(db, laura, (tx) => tx.query("select admin_invite_member($1::jsonb)", [JSON.stringify(p)]));
    expect(await err({ email: "no-es-mail", display_name: "Xavier", role: "compras" })).toMatch(/mail válido/);
    expect(await err({ email: "y@demo.com", display_name: "", role: "compras" })).toMatch(/nombre/);
    expect(await err({ email: "y@demo.com", display_name: "Yanina", role: "owner" })).toMatch(/rol válido/);
    expect(await err({ email: "martin@demo.com", display_name: "Martín", role: "compras" })).toMatch(/ya es un usuario/);
  });
  it("nadie se cambia el rol ni se da de baja a sí mismo", async () => {
    expect(await errorAs(db, laura, (tx) => tx.query("select admin_set_member_role($1, 'compras')", [laura]))).toMatch(/propio rol/);
    expect(await errorAs(db, laura, (tx) => tx.query("select admin_set_member_active($1, false)", [laura]))).toMatch(/a vos mismo/);
  });
  it("siempre queda al menos un Administrativo activo", async () => {
    await db.query("update organization_members set deactivated_at = now() where user_id = $1", [sofia]);
    await expect(db.query("update organization_members set deactivated_at = now() where user_id = $1", [laura])).rejects.toThrow(/al menos un usuario Administrativo/);
    await expect(db.query("update organization_members set role = 'compras' where user_id = $1", [laura])).rejects.toThrow(/al menos un usuario Administrativo/);
    await db.query("update organization_members set deactivated_at = null where user_id = $1", [sofia]);
  });
  it("cambiar de rol cambia lo que puede leer, y se puede volver atrás", async () => {
    await asUser(db, laura, (tx) => tx.query("select admin_set_member_role($1, 'compras')", [sofia]));
    expect(await rows(sofia, "select id from projects")).toHaveLength(0);
    expect((await call<{ status: string }>(sofia, "select compras_workspace() as r")).status).toBe("active");
    await asUser(db, laura, (tx) => tx.query("select admin_set_member_role($1, 'member')", [sofia]));
    expect(await rows(sofia, "select id from projects")).toHaveLength(0);
    await asUser(db, laura, tx => tx.query("select admin_set_commercial_access($1,true)",[sofia]));
    expect((await rows(sofia, "select id from projects")).length).toBeGreaterThan(0);
  });
  it("la baja de una cuenta le corta el acceso; al reactivarla vuelve", async () => {
    await asUser(db, laura, (tx) => tx.query("select admin_set_member_active($1, false)", [martin]));
    expect(await call(martin, "select compras_workspace() as r")).toEqual({ status: "inactive" });
    expect(await rows(martin, "select name from organizations")).toHaveLength(0);
    await asUser(db, laura, (tx) => tx.query("select admin_set_member_active($1, false)", [sofia]));
    expect(await rows(sofia, "select id from projects")).toHaveLength(0);
    expect(await errorAs(db, sofia, (tx) => tx.query("select admin_members()"))).toMatch(/Administrativo/);
    await asUser(db, laura, (tx) => tx.query("select admin_set_member_active($1, true)", [martin]));
    await asUser(db, laura, (tx) => tx.query("select admin_set_member_active($1, true)", [sofia]));
    expect((await call<{ status: string }>(martin, "select compras_workspace() as r")).status).toBe("active");
  });
  it("otra empresa no ve ni toca los usuarios de esta", async () => {
    const list = await call<{ members: { email: string }[] }>(outsider, "select admin_members() as r");
    expect(list.members.map((m) => m.email)).toEqual(["otra@empresa.com"]);
    expect(await errorAs(db, outsider, (tx) => tx.query("select admin_set_member_active($1, false)", [martin]))).toMatch(/no es de tu empresa/);
    expect(await errorAs(db, outsider, (tx) => tx.query("select admin_set_member_role($1, 'member')", [martin]))).toMatch(/no es de tu empresa/);
  });
});

const MONEY_TABLES = ["projects", "budget_lines", "purchase_entries", "material_usages", "actual_entries", "operators", "stock_lots", "hour_rates", "cost_settings", "price_history", "value_corrections"];

describe("Compras", () => {
  it("no tiene acceso directo a ninguna tabla con importes (ni llamando a la API)", async () => {
    for (const t of MONEY_TABLES) expect(await rows(martin, `select * from ${t}`), t).toHaveLength(0);
    expect(await rows(martin, "update projects set sales_price = 1 returning id")).toHaveLength(0);
    expect(await errorAs(db, martin, (tx) => tx.query("insert into price_history (organization_id, id, kind, subject_id, value, valid_from) values ($1, 'x', 'material_price', 'm', 1, now())", [org]))).toMatch(
      /row-level security/,
    );
  });
  it("lee proyectos y su lista de materiales con costo de compra, sin precio de venta, rentabilidad ni mano de obra", async () => {
    const ws = await call<{ projects: Record<string, unknown>[]; budget_lines: { category: string; unit_cost: number }[]; stock_lots: unknown[]; purchase_entries: unknown[] }>(
      martin,
      "select compras_workspace() as r",
    );
    expect(ws.projects.length).toBeGreaterThan(0);
    const keys = keysDeep(ws.projects);
    for (const k of ["sales_price", "baseline", "progress_percent"]) expect(keys.has(k), k).toBe(false);
    expect(ws.budget_lines.length).toBeGreaterThan(0);
    expect(new Set(ws.budget_lines.map((l) => l.category))).toEqual(new Set(["materials"]));
    expect(ws.stock_lots.length).toBeGreaterThan(0);
    const [{ price }] = (await db.query<{ price: string }>("select sales_price::text as price from projects where organization_id = $1 and id = $2", [org, MAIN_DEMO_PROJECT_ID])).rows;
    expect(JSON.stringify(ws)).not.toContain(price);
  });
  it("no puede usar las funciones de otros roles ni las de Administrativo", async () => {
    expect(await errorAs(db, martin, (tx) => tx.query("select planta_workspace()"))).toMatch(/Jefe de planta/);
    expect(await errorAs(db, martin, (tx) => tx.query("select taller_workspace()"))).toMatch(/no es operario/);
    expect(await errorAs(db, martin, (tx) => tx.query("select admin_correct_value('{}'::jsonb)"))).toMatch(/Administrativo/);
    expect(await errorAs(db, martin, (tx) => tx.query("select reset_workspace('{}'::jsonb)"))).toMatch(/Administrativo/);
  });
});

describe("Jefe de planta", () => {
  it("no tiene acceso directo a ninguna tabla con importes", async () => {
    for (const t of MONEY_TABLES) expect(await rows(carla, `select * from ${t}`), t).toHaveLength(0);
  });
  it("lee operarios, horas y proyectos sin ningún importe", async () => {
    const ws = await call<{ projects: unknown[]; operators: { name: string }[]; actual_entries: { labor: { hours: number } }[] }>(carla, "select planta_workspace() as r");
    expect(ws.operators.map((o) => o.name)).toContain("Juan Pérez");
    expect(ws.projects.length).toBeGreaterThan(0);
    expect(ws.actual_entries.length).toBeGreaterThan(0);
    expect(ws.actual_entries.every((e) => e.labor.hours > 0)).toBe(true);
    const keys = keysDeep(ws);
    for (const k of ["sales_price", "baseline", "unit_cost", "total", "amount", "hourly_cost", "hourlyCost", "pin_hash"]) expect(keys.has(k), k).toBe(false);
  });
  it("no puede usar las funciones de Compras ni de Administrativo", async () => {
    expect(await errorAs(db, carla, (tx) => tx.query("select compras_workspace()"))).toMatch(/Compras/);
    expect(await errorAs(db, carla, (tx) => tx.query("select admin_members()"))).toMatch(/Administrativo/);
  });
});

describe("Operario", () => {
  it("sigue sin acceso a nada económico y sin las funciones de otros roles", async () => {
    for (const t of MONEY_TABLES) expect(await rows(juan, `select * from ${t}`), t).toHaveLength(0);
    expect(await errorAs(db, juan, (tx) => tx.query("select compras_workspace()"))).toMatch(/Compras/);
    expect(await errorAs(db, juan, (tx) => tx.query("select planta_workspace()"))).toMatch(/Jefe de planta/);
  });
  it("con la cuenta dada de baja no accede, aunque la persona siga activa", async () => {
    await asUser(db, laura, (tx) => tx.query("select admin_set_member_active($1, false)", [juan]));
    expect(await call(juan, "select taller_workspace() as r")).toEqual({ status: "inactive" });
    await asUser(db, laura, (tx) => tx.query("select admin_set_member_active($1, true)", [juan]));
    expect((await call<{ status: string }>(juan, "select taller_workspace() as r")).status).toBe("active");
  });
});

describe("Administrativo", () => {
  it("accede a todo", async () => {
    for (const t of ["projects", "budget_lines", "actual_entries", "operators", "hour_rates", "price_history"]) expect((await rows(laura, `select * from ${t}`)).length, t).toBeGreaterThan(0);
  });
  it("otra empresa no ve nada de esta", async () => {
    for (const t of MONEY_TABLES) expect(await rows(outsider, `select * from ${t} where organization_id = $1`, [org]), t).toHaveLength(0);
  });
});

describe("precios con vigencia", () => {
  it("el historial solo crece: no se edita ni se borra (ni con acceso total a la base)", async () => {
    expect(await rows(laura, "update price_history set value = 1 where organization_id = $1 returning id", [org])).toHaveLength(0);
    expect(await rows(laura, "delete from price_history where organization_id = $1 returning id", [org])).toHaveLength(0);
    await expect(db.query("update price_history set value = 1 where organization_id = $1", [org])).rejects.toThrow(/historial/);
    await expect(db.query("delete from price_history where organization_id = $1", [org])).rejects.toThrow(/historial/);
  });
  it("las horas se valúan con el costo vigente ESE día: un cambio no altera lo anterior", async () => {
    const add = (id: string, value: number, from: string) =>
      asUser(db, laura, (tx) =>
        tx.query("insert into price_history (organization_id, id, kind, subject_id, value, valid_from, created_by) values ($1, $2, 'operator_cost', 'op-juan', $3, $4, 'Laura')", [org, id, value, from]),
      );
    await add("ph-juan-10", 10_000, daysAgo(40));
    await add("ph-juan-15", 15_000, daysAgo(6)); // cambio a mitad de mes
    const log = async (id: string, date: string) => {
      const assignment = await assignFor(db, laura, "op-juan", date, `asg-${id}`);
      return asUser(db, juan, (tx) => tx.query("select taller_log_hours($1::jsonb)", [JSON.stringify({ id, assignment_id: assignment, hours: 2, work_type: "Armado" })]));
    };
    await log("h-antes", daysAgo(9));
    await log("h-despues", daysAgo(3));
    const amount = async (id: string) => Number((await db.query<{ a: string }>("select amount::text as a from actual_entries where id = $1", [id])).rows[0].a);
    expect(await amount("h-antes")).toBe(20_000);
    expect(await amount("h-despues")).toBe(30_000);
    // Un cambio con fecha futura no afecta hoy.
    await add("ph-juan-futuro", 99_000, "2999-01-01");
    await log("h-hoy", daysAgo(1));
    expect(await amount("h-hoy")).toBe(30_000);
    expect(await amount("h-antes")).toBe(20_000);
  });
  it("con la valuación por tarifa general (hipótesis a confirmar), las horas usan la tarifa de Mano de obra de ese día", async () => {
    await db.query("update cost_settings set labor_valuation = 'general' where organization_id = $1", [org]);
    const assignment = await assignFor(db, laura, "op-juan", daysAgo(2), "asg-general");
    await asUser(db, juan, (tx) => tx.query("select taller_log_hours($1::jsonb)", [JSON.stringify({ id: "h-general", assignment_id: assignment, hours: 1, work_type: "Armado" })]));
    const [{ a }] = (await db.query<{ a: string }>("select amount::text as a from actual_entries where id = 'h-general'")).rows;
    expect(Number(a)).toBe(19_000);
    await db.query("update cost_settings set labor_valuation = 'operator' where organization_id = $1", [org]);
  });
});

describe("valores congelados y correcciones auditadas", () => {
  it("desde Aprobado el precio de venta y el costo presupuestado no se editan directo", async () => {
    expect(await errorAs(db, laura, (tx) => tx.query("update projects set sales_price = sales_price + 1 where organization_id = $1 and id = $2", [org, APPROVED]))).toMatch(/congelado/);
    expect(await errorAs(db, laura, (tx) => tx.query("update budget_lines set unit_cost = unit_cost + 1 where organization_id = $1 and project_id = $2", [org, APPROVED]))).toMatch(/congelado/);
    // En Cotización sí.
    await asUser(db, laura, (tx) => tx.query("update projects set sales_price = sales_price + 1 where organization_id = $1 and id = $2", [org, QUOTATION]));
  });
  it("una corrección cambia el valor y deja registro: quién, cuándo, valor anterior, nuevo y motivo", async () => {
    const [{ price }] = (await db.query<{ price: string }>("select sales_price::text as price from projects where organization_id = $1 and id = $2", [org, APPROVED])).rows;
    const res = await call<{ old_value: number; corrected_by: string }>(laura, "select admin_correct_value($1::jsonb) as r", [
      JSON.stringify({ project_id: APPROVED, target: "sales_price", field: "sales_price", new_value: 123_456, reason: "El cliente aceptó un descuento" }),
    ]);
    expect(Number(res.old_value)).toBe(Number(price));
    expect(res.corrected_by).toBe("Laura Gómez");
    const [c] = (await db.query<Record<string, string>>("select old_value::text, new_value::text, reason, corrected_by from value_corrections where organization_id = $1 and project_id = $2", [org, APPROVED])).rows;
    expect(c).toEqual({ old_value: price, new_value: "123456", reason: "El cliente aceptó un descuento", corrected_by: "Laura Gómez" });
    const [{ sales_price }] = (await db.query<{ sales_price: string }>("select sales_price::text from projects where organization_id = $1 and id = $2", [org, APPROVED])).rows;
    expect(sales_price).toBe("123456");
    const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from activity_events where organization_id = $1 and project_id = $2 and message like 'Corrección de precio de venta%'", [org, APPROVED])).rows;
    expect(n).toBe(1);
  });
  it("una línea del costo presupuestado se corrige y el total se recalcula; también en un proyecto cerrado", async () => {
    const [line] = (await db.query<{ id: string; quantity: string }>("select id, quantity::text from budget_lines where organization_id = $1 and project_id = $2 and quantity is not null limit 1", [org, CLOSED])).rows;
    await asUser(db, laura, (tx) =>
      tx.query("select admin_correct_value($1::jsonb)", [JSON.stringify({ project_id: CLOSED, target: "budget_line", line_id: line.id, field: "unit_cost", new_value: 1000, reason: "Error de tipeo" })]),
    );
    const [after] = (await db.query<{ unit_cost: string; total: string }>("select unit_cost::text, total::text from budget_lines where organization_id = $1 and id = $2", [org, line.id])).rows;
    expect(Number(after.unit_cost)).toBe(1000);
    expect(Number(after.total)).toBe(Math.round(Number(line.quantity) * 1000 * 100) / 100);
  });
  it("sin motivo, en Cotización o por otro rol, no hay corrección; el registro no se edita", async () => {
    const correct = (u: string, p: Record<string, unknown>) => errorAs(db, u, (tx) => tx.query("select admin_correct_value($1::jsonb)", [JSON.stringify(p)]));
    const base = { project_id: APPROVED, target: "sales_price", field: "sales_price", new_value: 1, reason: "Motivo válido" };
    expect(await correct(laura, { ...base, reason: " " })).toMatch(/motivo/);
    expect(await correct(laura, { ...base, project_id: QUOTATION })).toMatch(/Cotización/);
    expect(await correct(juan, base)).toMatch(/Administrativo/);
    expect(await correct(carla, base)).toMatch(/Administrativo/);
    expect(await rows(laura, "update value_corrections set reason = 'x' where organization_id = $1 returning id", [org])).toHaveLength(0);
    await expect(db.query("update value_corrections set reason = 'x' where organization_id = $1", [org])).rejects.toThrow(/historial/);
  });
});
