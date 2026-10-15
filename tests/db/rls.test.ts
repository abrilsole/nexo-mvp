// Lote 2 — Seguridad: políticas de la base probadas en un Postgres real (PGlite) con tres usuarios:
// Gestión (Laura), un operario activo (Juan) y un operario dado de baja (Diego).
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Project } from "@/types";
import { CATEGORY_ORDER, DEFAULT_HOUR_RATES, DEFAULT_SETTINGS, normalizeCategory } from "@/lib/constants";
import { hourRateToRow } from "@/lib/supabase/mappers";
import { buildSeed, MAIN_DEMO_PROJECT_ID } from "@/lib/seed-data";
import { projectHoldings, type StockState } from "@/lib/stock";
import * as ops from "@/lib/project-operations";
import { workspacePayload } from "@/lib/supabase/workspace";
import { tallerCalls } from "@/lib/supabase/taller";
import { asUser, createDb, errorAs, signUp } from "./harness";

let db: PGlite;
let org = "";
let laura = "";
let juan = "";
let diego = "";
let outsider = "";
let seed: { projects: Project[]; stock: StockState };

/** Fecha de hace unos días (evita problemas de zona horaria con "hoy"). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** La parte de una migración que convierte datos (desde que se activa la carga masiva). */
const conversionSql = (file: string) => {
  const sql = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations", file), "utf8");
  return sql.slice(sql.indexOf("select set_config('blerp.bulk', 'on', true);"));
};

const rows = async (userId: string, sql: string, params: unknown[] = []) =>
  asUser(db, userId, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);

beforeAll(async () => {
  db = await createDb();
  laura = await signUp(db, "laura@demo.com", "Laura Gómez");
  org = (await db.query<{ organization_id: string }>("select organization_id from organization_members where user_id = $1", [laura])).rows[0]
    .organization_id;

  // Gestión carga la demo con la misma función que usa la app (reset_workspace).
  const s = buildSeed(new Date());
  seed = { projects: s.projects, stock: s.stock };
  const payload = workspacePayload(org, {
    projects: s.projects,
    operators: s.operators,
    stock: s.stock,
    requests: [],
    assignments: [],
    settings: { ...DEFAULT_SETTINGS },
    resolvedAlertIds: [],
  });
  await asUser(db, laura, (tx) => tx.query("select reset_workspace($1::jsonb)", [JSON.stringify(payload)]));

  // Gestión invita a Juan y a Diego por email: al registrarse quedan como operarios de la empresa.
  await db.query("update operators set email = 'juan@demo.com' where organization_id = $1 and id = 'op-juan'", [org]);
  await db.query("update operators set email = 'diego@demo.com' where organization_id = $1 and id = 'op-diego'", [org]);
  juan = await signUp(db, "juan@demo.com", "Juan");
  diego = await signUp(db, "diego@demo.com", "Diego");
  outsider = await signUp(db, "otra@empresa.com", "Otra Empresa");
}, 120_000);

describe("la demo se carga completa con reset_workspace", () => {
  it("todas las tablas quedan con los datos del seed", async () => {
    const [{ n }] = (await db.query<{ n: number }>("select count(*)::int as n from projects where organization_id = $1", [org])).rows;
    expect(n).toBe(seed.projects.length);
    const [{ m }] = (await db.query<{ m: number }>("select count(*)::int as m from stock_movements where organization_id = $1", [org])).rows;
    expect(m).toBe(seed.stock.movements.length);
  });
  it("un operario no puede resetear la empresa", async () => {
    expect(await errorAs(db, juan, (tx) => tx.query("select reset_workspace('{}'::jsonb)"))).toMatch(/Solo un usuario Administrativo/);
  });
});

describe("Gestión (manager)", () => {
  it("ve lo económico: precios de venta y costo por hora", async () => {
    const projects = await rows(laura, "select id, sales_price from projects");
    expect(projects).toHaveLength(seed.projects.length);
    expect(projects.some((p) => Number(p.sales_price) > 0)).toBe(true);
    const operators = await rows(laura, "select id, hourly_cost from operators");
    expect(operators.every((o) => Number(o.hourly_cost) > 0)).toBe(true);
  });
  it("una empresa nueva (sin demo cargada) puede cargar su primera demo tabla por tabla", async () => {
    // Es lo que hace el primer ingreso con la versión anterior de la app: no debe chocar con las reglas.
    const [{ organization_id: other }] = await rows(outsider, "select organization_id from organization_members");
    const err = await errorAs(db, outsider, async (tx) => {
      await tx.query(
        "insert into projects (organization_id, id, code, name, status, start_date, due_date) values ($1, 'p-1', 'P-1', 'Nuevo', 'production', current_date, current_date)",
        [other],
      );
      await tx.query(
        "insert into budget_lines (organization_id, id, project_id, category, description, quantity, unit, unit_cost, total) values ($1, 'bl-1', 'p-1', 'materials', 'x', 1, 'u', 1, 1)",
        [other],
      );
    });
    expect(err).toBeNull();
  });
  it("otra empresa no ve nada de esta", async () => {
    expect(await rows(outsider, "select id from projects where organization_id = $1", [org])).toHaveLength(0);
  });
  it("las etapas se avanzan de a una (también en la base)", async () => {
    const p = seed.projects.find((x) => x.status === "purchasing")!;
    expect(
      await errorAs(db, laura, (tx) => tx.query("update projects set status = 'installation' where organization_id = $1 and id = $2", [org, p.id])),
    ).toMatch(/de a una/);
  });
  it("el presupuesto base congelado no se reemplaza", async () => {
    const p = seed.projects.find((x) => x.status === "production")!;
    expect(
      await errorAs(db, laura, (tx) =>
        tx.query("update projects set baseline = jsonb_set(baseline, '{budgetTotal}', '1') where organization_id = $1 and id = $2", [org, p.id]),
      ),
    ).toMatch(/congelado/);
  });
  it("el costo presupuestado está bloqueado en ejecución", async () => {
    expect(
      await errorAs(db, laura, (tx) =>
        tx.query(
          "insert into budget_lines (organization_id, id, project_id, category, description, quantity, unit, unit_cost, total) values ($1, 'bl-x', $2, 'materials', 'x', 1, 'u', 1, 1)",
          [org, MAIN_DEMO_PROJECT_ID],
        ),
      ),
    ).toMatch(/congelado/);
  });
  it("no se cargan horas con fecha futura ni más de 24 h por día", async () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const insert = (date: string, hours: number, id: string) =>
      errorAs(db, laura, (tx) =>
        tx.query(
          `insert into actual_entries (organization_id, id, project_id, date, type, category, description, amount, labor, operator_id, created_by)
           values ($1, $2, $3, $4, 'labor', 'labor', 'x', 1, jsonb_build_object('hours', $5::numeric), 'op-sofia', 'Laura')`,
          [org, id, MAIN_DEMO_PROJECT_ID, date, hours],
        ),
      );
    expect(await insert(future.toISOString().slice(0, 10), 2, "h-future")).toMatch(/futura/);
    expect(await insert(daysAgo(3), 25, "h-25")).toMatch(/24 h/);
  });
  it("no se elimina un operario con horas registradas", async () => {
    expect(await errorAs(db, laura, (tx) => tx.query("delete from operators where organization_id = $1 and id = 'op-juan'", [org]))).toMatch(
      /solo dar de baja/,
    );
  });
  it("el libro de stock no se edita", async () => {
    expect(
      await errorAs(db, laura, (tx) => tx.query("update stock_movements set quantity = quantity + 1 where organization_id = $1", [org])),
    ).toMatch(/solo crece/);
  });
});

describe("Operario activo (Juan)", () => {
  it("no tiene acceso directo a ninguna tabla con plata", async () => {
    for (const t of ["projects", "budget_lines", "purchase_entries", "material_usages", "actual_entries", "operators", "stock_lots", "activity_events"]) {
      expect(await rows(juan, `select * from ${t}`)).toHaveLength(0);
    }
    expect(await rows(juan, "select name from organizations")).toHaveLength(1);
    expect(await rows(juan, "select user_id from organization_members")).toEqual([{ user_id: juan }]);
  });
  it("no puede escribir directo en las tablas", async () => {
    const updated = await rows(juan, "update projects set sales_price = 1 where organization_id = $1 returning id", [org]);
    expect(updated).toHaveLength(0);
    expect(
      await errorAs(db, juan, (tx) =>
        tx.query(
          "insert into actual_entries (organization_id, id, project_id, date, type, category, description, amount, labor, created_by) values ($1, 'x', $2, $3, 'outsourcing', 'outsourcing', 'x', 1, null, 'Juan')",
          [org, MAIN_DEMO_PROJECT_ID, daysAgo(2)],
        ),
      ),
    ).toMatch(/row-level security/);
  });
  it("taller_workspace trae solo sus proyectos en Taller y sin costos, precios ni márgenes", async () => {
    const [{ ws }] = await rows(juan, "select taller_workspace() as ws");
    const json = ws as { status: string; projects: { id: string; status: string; sales_price: number; assigned_operator_ids: string[] }[]; actual_entries: { amount: number; labor: { hourlyCost: number } }[]; stock_lots: { unit_cost: number }[] };
    expect(json.status).toBe("active");
    const expected = seed.projects.filter((p) => !p.isClosed && ["purchasing", "production", "installation"].includes(p.status) && p.assignedOperatorIds.includes("op-juan"));
    expect(json.projects.map((p) => p.id).sort()).toEqual(expected.map((p) => p.id).sort());
    expect(json.projects.every((p) => p.sales_price === 0)).toBe(true);
    expect(json.actual_entries.every((e) => e.amount === 0 && e.labor.hourlyCost === 0)).toBe(true);
    expect(json.stock_lots.length).toBeGreaterThan(0);
    expect(json.stock_lots.every((l) => l.unit_cost === 0)).toBe(true);
    const text = JSON.stringify(ws);
    for (const p of expected) expect(text).not.toContain(`"sales_price":${p.salesPrice}`);
    expect(text).not.toContain("15000");
  });
  it("carga sus horas y el costo lo calcula el servidor", async () => {
    await asUser(db, juan, (tx) =>
      tx.query("select taller_log_hours($1::jsonb)", [
        JSON.stringify({ id: "h-juan-1", project_id: MAIN_DEMO_PROJECT_ID, date: daysAgo(2), hours: 3, work_type: "Armado" }),
      ]),
    );
    const [e] = (await db.query<{ amount: string; labor: { hourlyCost: number } }>("select amount, labor from actual_entries where id = 'h-juan-1'")).rows;
    expect(Number(e.amount)).toBe(45_000);
    expect(e.labor.hourlyCost).toBe(15_000);
  });
  it("no carga en proyectos donde no está asignado", async () => {
    const other = seed.projects.find((p) => p.status === "quotation")!;
    expect(
      await errorAs(db, juan, (tx) =>
        tx.query("select taller_log_hours($1::jsonb)", [JSON.stringify({ project_id: other.id, date: daysAgo(2), hours: 1, work_type: "Armado" })]),
      ),
    ).toMatch(/No estás asignado/);
  });
  it("registra consumo: el costo sale del lote, no del navegador", async () => {
    const project = seed.projects.find((p) => p.id === MAIN_DEMO_PROJECT_ID)!;
    const holding = projectHoldings(seed.stock, project.id)[0];
    const ctx: ops.Ctx = { actor: "Juan Pérez", now: new Date().toISOString(), role: "operator", operatorId: "op-juan" };
    const res = ops.registerUsage(
      project,
      seed.stock,
      { materialId: holding.lot.materialId, materialName: holding.lot.materialName, unit: holding.lot.unit, consumed: 0.5, waste: 0.1, date: daysAgo(1), leftover: { quantity: 0.2 } },
      DEFAULT_SETTINGS,
      ctx,
    );
    const calls = tallerCalls(
      { projects: seed.projects, stock: seed.stock, requests: [] },
      { projects: seed.projects.map((p) => (p.id === project.id ? res.project : p)), stock: res.stock, requests: [] },
      org,
    );
    expect(calls.map((c) => c.fn)).toEqual(["taller_register_usage"]);
    // Aunque el navegador mandara un costo, el servidor usa el del lote.
    await asUser(db, juan, (tx) => tx.query("select taller_register_usage($1::jsonb)", [JSON.stringify(calls[0].p)]));
    const usages = (await db.query<{ unit_cost: string; quantity_consumed: string }>(
      "select unit_cost, quantity_consumed from material_usages where organization_id = $1 and created_by = 'Juan Pérez'",
      [org],
    )).rows;
    expect(usages.length).toBeGreaterThan(0);
    expect(Number(usages[0].unit_cost)).toBe(holding.lot.unitCost);
    const [leftover] = (await db.query<{ unit_cost: string }>(
      "select unit_cost from stock_lots where organization_id = $1 and kind = 'leftover' and created_by = 'Juan Pérez'",
      [org],
    )).rows;
    expect(Number(leftover.unit_cost)).toBe(holding.lot.unitCost);
  });
  it("no puede usar más material del asignado", async () => {
    const holding = projectHoldings(seed.stock, MAIN_DEMO_PROJECT_ID)[0];
    const place = { type: "project", projectId: MAIN_DEMO_PROJECT_ID };
    const p = {
      project_id: MAIN_DEMO_PROJECT_ID,
      date: daysAgo(1),
      movements: [{ id: "mov-big", lot_id: holding.lot.id, kind: "consume", quantity: 9999, from_place: place, to_place: { type: "consumed", projectId: MAIN_DEMO_PROJECT_ID }, project_id: MAIN_DEMO_PROJECT_ID }],
      usages: [{ id: "use-big", lot_id: holding.lot.id, material_id: holding.lot.materialId, quantity_consumed: 9999, waste_quantity: 0 }],
    };
    expect(await errorAs(db, juan, (tx) => tx.query("select taller_register_usage($1::jsonb)", [JSON.stringify(p)]))).toMatch(/No alcanza/);
  });
  it("no puede sacar material de otro proyecto", async () => {
    const other = seed.projects.find((x) => x.id !== MAIN_DEMO_PROJECT_ID && projectHoldings(seed.stock, x.id).length > 0)!;
    const holding = projectHoldings(seed.stock, other.id)[0];
    const p = {
      project_id: MAIN_DEMO_PROJECT_ID,
      date: daysAgo(1),
      movements: [{ id: "mov-steal", lot_id: holding.lot.id, kind: "consume", quantity: 0.1, from_place: { type: "project", projectId: other.id }, to_place: { type: "consumed", projectId: MAIN_DEMO_PROJECT_ID } }],
      usages: [{ id: "use-steal", lot_id: holding.lot.id, material_id: holding.lot.materialId, quantity_consumed: 0.1, waste_quantity: 0 }],
    };
    expect(await errorAs(db, juan, (tx) => tx.query("select taller_register_usage($1::jsonb)", [JSON.stringify(p)]))).toMatch(/asignado a este proyecto/);
  });
  it("pide material y deja una nota; Gestión los ve", async () => {
    await asUser(db, juan, async (tx) => {
      await tx.query("select taller_request_material($1::jsonb)", [
        JSON.stringify({ id: "req-juan", project_id: MAIN_DEMO_PROJECT_ID, material_id: "bisagra", material_name: "Herraje bisagra", quantity: 10, unit: "u" }),
      ]);
      await tx.query("select taller_add_stage_log($1::jsonb)", [
        JSON.stringify({ id: "log-juan", project_id: MAIN_DEMO_PROJECT_ID, stage: "production", date: daysAgo(1), kind: "incident", text: "Se rompió una placa al cortar." }),
      ]);
    });
    expect(await rows(laura, "select id from material_requests where id = 'req-juan'")).toHaveLength(1);
    expect(await rows(laura, "select id from stage_logs where id = 'log-juan'")).toHaveLength(1);
  });
  it("ve los archivos de su empresa, no los de otra", async () => {
    await db.query("insert into storage.objects (bucket_id, name) values ('project-files', $1), ('project-files', $2)", [
      `${org}/${MAIN_DEMO_PROJECT_ID}/foto.jpg`,
      `00000000-0000-0000-0000-000000000000/p-ajeno/plano.pdf`,
    ]);
    const visible = await rows(juan, "select name from storage.objects");
    expect(visible.map((o) => o.name)).toEqual([`${org}/${MAIN_DEMO_PROJECT_ID}/foto.jpg`]);
  });
});

describe("Operario dado de baja (Diego)", () => {
  it("antes de la baja tiene acceso a Taller", async () => {
    const [{ ws }] = await rows(diego, "select taller_workspace() as ws");
    expect((ws as { status: string }).status).toBe("active");
  });
  it("la baja le corta el acceso real a la base", async () => {
    await asUser(db, laura, (tx) => tx.query("update operators set active = false, deactivated_at = now() where organization_id = $1 and id = 'op-diego'", [org]));
    const [{ ws }] = await rows(diego, "select taller_workspace() as ws");
    expect(ws).toEqual({ status: "inactive" });
    expect(await rows(diego, "select * from organizations")).toHaveLength(0);
    expect(await rows(diego, "select name from storage.objects")).toHaveLength(0);
    expect(
      await errorAs(db, diego, (tx) =>
        tx.query("select taller_log_hours($1::jsonb)", [JSON.stringify({ project_id: MAIN_DEMO_PROJECT_ID, date: daysAgo(1), hours: 1, work_type: "Armado" })]),
      ),
    ).toMatch(/dado de baja/);
  });
  it("con deactivated_at alcanza para cortar el acceso, aunque quede active = true", async () => {
    await db.query("update operators set active = true, deactivated_at = now() where organization_id = $1 and id = 'op-diego'", [org]);
    const [{ ws }] = await rows(diego, "select taller_workspace() as ws");
    expect(ws).toEqual({ status: "inactive" });
  });
  it("al reactivarlo vuelve a tener acceso", async () => {
    await asUser(db, laura, (tx) => tx.query("update operators set active = true, deactivated_at = null where organization_id = $1 and id = 'op-diego'", [org]));
    const [{ ws }] = await rows(diego, "select taller_workspace() as ws");
    expect((ws as { status: string }).status).toBe("active");
  });
});

describe("Lote 3 · operarios y horas extra en el costo presupuestado", () => {
  const quote = () => seed.projects.find((p) => p.status === "quotation")!;

  it("Gestión guarda el operario asignado y las horas normales y extra de cada rol", async () => {
    const p = quote();
    await asUser(db, laura, (tx) =>
      tx.query(
        `insert into budget_lines (organization_id, id, project_id, position, category, description, quantity, unit, unit_cost, total,
           operator_id, labor_role, hour_type, overtime_multiplier)
         values ($1, 'bl-l3-n', $2, 90, 'labor', 'Carpintería: Juan · horas normales', 80, 'h', 15000, 1200000, 'op-juan', 'Carpintería', 'normal', null),
                ($1, 'bl-l3-x', $2, 91, 'labor', 'Carpintería: Juan · horas extra (×2)', 20, 'h', 30000, 600000, 'op-juan', 'Carpintería', 'overtime', 2)`,
        [org, p.id],
      ),
    );
    const saved = await rows(laura, "select id, operator_id, hour_type, quantity, overtime_multiplier from budget_lines where id like 'bl-l3-%' order by id");
    expect(saved.map((r) => [r.operator_id, r.hour_type, Number(r.quantity)])).toEqual([
      ["op-juan", "normal", 80],
      ["op-juan", "overtime", 20],
    ]);
  });

  it("el tipo de hora y el multiplicador se validan en la base", async () => {
    const p = quote();
    expect(
      await errorAs(db, laura, (tx) =>
        tx.query(
          "insert into budget_lines (organization_id, id, project_id, category, description, quantity, unit, unit_cost, total, hour_type) values ($1, 'bl-bad', $2, 'labor', 'x', 1, 'h', 1, 1, 'feriado')",
          [org, p.id],
        ),
      ),
    ).toMatch(/budget_lines_hour_type_check/);
  });

  it("Gestión ajusta el multiplicador (por defecto 2, por ejemplo 1,5)", async () => {
    await asUser(db, laura, (tx) => tx.query("insert into cost_settings (organization_id) values ($1)", [org]));
    expect(Number((await rows(laura, "select overtime_multiplier from cost_settings"))[0].overtime_multiplier)).toBe(2);
    await asUser(db, laura, (tx) => tx.query("update cost_settings set overtime_multiplier = 1.5 where organization_id = $1", [org]));
    expect(Number((await rows(laura, "select overtime_multiplier from cost_settings"))[0].overtime_multiplier)).toBe(1.5);
    expect(
      await errorAs(db, laura, (tx) => tx.query("update cost_settings set overtime_multiplier = 0.5 where organization_id = $1", [org])),
    ).toMatch(/check/);
  });

  it("Taller nunca ve el multiplicador, los costos ni las horas extra presupuestadas", async () => {
    expect(await rows(juan, "select * from cost_settings")).toHaveLength(0);
    expect(await rows(juan, "select * from budget_lines where hour_type is not null")).toHaveLength(0);
    const updated = await rows(juan, "update cost_settings set overtime_multiplier = 1 where organization_id = $1 returning organization_id", [org]);
    expect(updated).toHaveLength(0);
    expect(await errorAs(db, juan, (tx) => tx.query("insert into cost_settings (organization_id) values ($1)", [org]))).toMatch(/row-level security|duplicate/);
    const [{ ws }] = await rows(juan, "select taller_workspace() as ws");
    const text = JSON.stringify(ws);
    expect(text).not.toContain("overtime");
    expect(text).not.toContain("hour_type");
    // Ni el multiplicador ni el costo por hora aparecen en lo que recibe Taller.
    const org_row = await rows(juan, "select * from organizations");
    expect(JSON.stringify(org_row)).not.toContain("overtime");
  });

  it("un operario dado de baja y otra empresa tampoco lo ven", async () => {
    expect(await rows(outsider, "select * from cost_settings")).toHaveLength(0);
    expect(await rows(outsider, "select * from budget_lines where hour_type is not null")).toHaveLength(0);
  });
});

describe("Lote 4 · rubros, tarifas y categorías de reporte", () => {
  it("la demo se carga con las categorías nuevas y el rubro en cada línea de costo presupuestado", async () => {
    const lines = await rows(laura, "select category, rubro from budget_lines where id not like 'bl-l3-%'");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => (CATEGORY_ORDER as string[]).includes(String(l.category)))).toBe(true);
    expect(lines.every((l) => l.rubro !== null)).toBe(true);
  });

  it("Gestión carga y cambia las tarifas por tipo de hora", async () => {
    const rates = DEFAULT_HOUR_RATES.map((r, i) => hourRateToRow(org, r, i));
    await asUser(db, laura, async (tx) => {
      for (const r of rates) {
        await tx.query(
          "insert into hour_rates (organization_id, id, name, hourly_rate, kind, position) values ($1, $2, $3, $4, $5, $6)",
          [r.organization_id, r.id, r.name, r.hourly_rate, r.kind, r.position],
        );
      }
    });
    await asUser(db, laura, (tx) => tx.query("update hour_rates set hourly_rate = 20000 where organization_id = $1 and id = 'labor'", [org]));
    const saved = await rows(laura, "select id, hourly_rate from hour_rates order by position");
    expect(saved.map((r) => [r.id, Number(r.hourly_rate)])).toEqual([
      ["labor", 20_000],
      ["design", 27_000],
      ["admin", 27_000],
    ]);
    // Cambiar Diseño no toca Administración.
    await asUser(db, laura, (tx) => tx.query("update hour_rates set hourly_rate = 30000 where organization_id = $1 and id = 'design'", [org]));
    expect((await rows(laura, "select id, hourly_rate from hour_rates where id in ('design', 'admin') order by position")).map((r) => Number(r.hourly_rate))).toEqual([
      30_000, 27_000,
    ]);
    expect(await errorAs(db, laura, (tx) => tx.query("update hour_rates set hourly_rate = 0 where organization_id = $1", [org]))).toMatch(/check/);
    expect(await errorAs(db, laura, (tx) => tx.query("update hour_rates set kind = 'otro' where organization_id = $1", [org]))).toMatch(/hour_rates_kind_check/);
  });

  it("el gasto financiero se guarda con Gestión (5% por defecto) y se valida", async () => {
    expect(Number((await rows(laura, "select financial_pct from cost_settings"))[0].financial_pct)).toBe(5);
    await asUser(db, laura, (tx) => tx.query("update cost_settings set financial_pct = 4.5 where organization_id = $1", [org]));
    expect(Number((await rows(laura, "select financial_pct from cost_settings"))[0].financial_pct)).toBe(4.5);
    expect(await errorAs(db, laura, (tx) => tx.query("update cost_settings set financial_pct = 80 where organization_id = $1", [org]))).toMatch(/check/);
  });

  it("Taller no puede leer ni cambiar tarifas ni gasto financiero, y no los recibe en taller_workspace", async () => {
    expect(await rows(juan, "select * from hour_rates")).toHaveLength(0);
    expect(await rows(juan, "select * from cost_settings")).toHaveLength(0);
    expect(await rows(juan, "update hour_rates set hourly_rate = 1 where organization_id = $1 returning id", [org])).toHaveLength(0);
    expect(await errorAs(db, juan, (tx) => tx.query("insert into hour_rates (organization_id, id, name, hourly_rate, kind) values ($1, 'x', 'x', 1, 'labor')", [org]))).toMatch(
      /row-level security/,
    );
    const [{ ws }] = await rows(juan, "select taller_workspace() as ws");
    const text = JSON.stringify(ws);
    expect(text).not.toContain("hourly_rate");
    expect(text).not.toContain("financial");
    expect(text).not.toContain("19000");
    expect(text).not.toContain("27000");
    expect(await rows(outsider, "select * from hour_rates")).toHaveLength(0);
  });

  it("el mapeo de categorías de la base coincide con el de la app", async () => {
    const cases: Array<[string, string]> = [
      ["materials", "Melamina"],
      ["labor", "Horas"],
      ["machines", "Máquina: Seccionadora"],
      ["outsourcing", "Laqueado"],
      ["finishing", "Pintura"],
      ["logistics", "Flete"],
      ["installation", "Instalación en obra"],
      ["contingency", "Varios"],
      ["other", "Máquina: CNC"],
      ["other", "Varios"],
    ];
    for (const [category, description] of cases) {
      const [{ c }] = (await db.query<{ c: string }>("select private.legacy_category($1, $2) as c", [category, description])).rows;
      expect(c, `${category} / ${description}`).toBe(normalizeCategory(category, description));
    }
  });

  it("el rubro de una línea vieja sale de la categoría o de la descripción (sin inventar en horas)", async () => {
    const rubro = async (category: string, description: string) =>
      (await db.query<{ r: string | null }>("select private.legacy_rubro($1, $2) as r", [category, description])).rows[0].r;
    expect(await rubro("logistics", "Flete a Recoleta")).toBe("transporte");
    expect(await rubro("installation", "Instalación en local")).toBe("montaje");
    expect(await rubro("contingency", "Varios")).toBe("imprevistos");
    expect(await rubro("outsourcing", "Laqueado barra — Taller Colores")).toBe("pintura");
    expect(await rubro("outsourcing", "Vidrios templados")).toBe("vidrios");
    expect(await rubro("outsourcing", "Impresión y ploteo de gráfica")).toBe("graficas");
    expect(await rubro("materials", "Herraje bisagra")).toBe("herrajes");
    expect(await rubro("materials", "Perfil aluminio")).toBe("carpinteria_metalica");
    expect(await rubro("materials", "Melamina blanca 18 mm")).toBe("carpinteria_madera");
    expect(await rubro("labor", "Horas de taller")).toBeNull();
    expect(await rubro("machines", "Máquina: Seccionadora")).toBeNull();
  });

  it("convierte datos viejos sin perder importes (incluye proyectos cerrados y el presupuesto base)", async () => {
    const p = seed.projects.find((x) => x.status === "completed")!;
    // Simula filas escritas con las categorías anteriores (carga masiva: así las dejó la versión vieja).
    await db.exec(`
      begin;
      select set_config('blerp.bulk', 'on', true);
      insert into budget_lines (organization_id, id, project_id, category, description, quantity, unit, unit_cost, total)
        values ('${org}', 'bl-old-1', '${p.id}', 'logistics', 'Flete', null, 'global', 1000, 1000),
               ('${org}', 'bl-old-2', '${p.id}', 'machines', 'Máquina: Seccionadora', 2, 'h', 500, 1000);
      insert into actual_entries (organization_id, id, project_id, date, type, category, description, amount, created_by)
        values ('${org}', 'act-old-1', '${p.id}', '2026-01-05', 'installation', 'installation', 'Instalación', 777, 'Laura');
      update projects set baseline = jsonb_set(baseline, '{lines,0,category}', '"outsourcing"') where organization_id = '${org}' and id = '${p.id}';
      commit;
    `);
    await db.exec(conversionSql("20261013120000_lote4_rubros.sql")); // la conversión se puede volver a correr sin efectos extra
    const lines = (await db.query<{ id: string; category: string; rubro: string | null; total: string }>("select id, category, rubro, total from budget_lines where id like 'bl-old-%' order by id")).rows;
    expect(lines.map((l) => [l.id, l.category, l.rubro, Number(l.total)])).toEqual([
      ["bl-old-1", "transport", "transporte", 1000],
      ["bl-old-2", "labor", null, 1000],
    ]);
    const [entry] = (await db.query<{ category: string; amount: string }>("select category, amount from actual_entries where id = 'act-old-1'")).rows;
    expect([entry.category, Number(entry.amount)]).toEqual(["labor", 777]);
    const [{ c }] = (await db.query<{ c: string }>("select baseline -> 'lines' -> 0 ->> 'category' as c from projects where organization_id = $1 and id = $2", [org, p.id])).rows;
    expect(c).toBe("materials");
  });
});

describe("Lote 4b · Diseño y Administración por separado", () => {
  it("las líneas de Administración y diseño van a Diseño solo si lo indican; si no, a Administración", async () => {
    const p = seed.projects.find((x) => x.status === "completed")!;
    await db.exec(`
      begin;
      select set_config('blerp.bulk', 'on', true);
      insert into budget_lines (organization_id, id, project_id, category, description, quantity, unit, unit_cost, total, hour_rate_id)
        values ('${org}', 'bl-ad-1', '${p.id}', 'admin', 'Carpintería madera: horas administrativas / diseño', 10, 'h', 27000, 270000, 'admin'),
               ('${org}', 'bl-ad-2', '${p.id}', 'admin', 'Diseño de planos', 4, 'h', 25000, 100000, 'admin'),
               ('${org}', 'bl-ad-3', '${p.id}', 'admin', 'Gestoría', null, 'global', 5000, 5000, null);
      insert into actual_entries (organization_id, id, project_id, date, type, category, description, amount, created_by)
        values ('${org}', 'act-ad-1', '${p.id}', '2026-01-05', 'other', 'admin', 'Renders y diseño', 900, 'Laura'),
               ('${org}', 'act-ad-2', '${p.id}', '2026-01-05', 'other', 'admin', 'Comisión bancaria', 300, 'Laura');
      update projects set baseline = jsonb_set(baseline, '{lines,0}', baseline -> 'lines' -> 0 || '{"category": "admin", "description": "Diseño 3D"}')
        where organization_id = '${org}' and id = '${p.id}';
      commit;
    `);
    const before = (await db.query<{ n: string; s: string }>("select count(*) n, sum(total) s from budget_lines where organization_id = $1", [org])).rows[0];
    await db.exec(conversionSql("20261014120000_lote4b_diseno_administracion.sql"));
    const after = (await db.query<{ n: string; s: string }>("select count(*) n, sum(total) s from budget_lines where organization_id = $1", [org])).rows[0];
    expect(after).toEqual(before);
    const lines = (await db.query<{ id: string; category: string; hour_rate_id: string | null; unit_cost: string }>(
      "select id, category, hour_rate_id, unit_cost from budget_lines where id like 'bl-ad-%' order by id",
    )).rows;
    expect(lines.map((l) => [l.id, l.category, l.hour_rate_id, Number(l.unit_cost)])).toEqual([
      ["bl-ad-1", "admin", "admin", 27_000], // dice las dos cosas: no se inventa → Administración
      ["bl-ad-2", "design", "design", 25_000], // la tarifa queda congelada
      ["bl-ad-3", "admin", null, 5_000],
    ]);
    const entries = (await db.query<{ category: string }>("select category from actual_entries where id like 'act-ad-%' order by id")).rows;
    expect(entries.map((e) => e.category)).toEqual(["design", "admin"]);
    const [{ c }] = (await db.query<{ c: string }>("select baseline -> 'lines' -> 0 ->> 'category' as c from projects where organization_id = $1 and id = $2", [org, p.id])).rows;
    expect(c).toBe("design");
  });

  it("cada empresa tiene los tres tipos de hora; Diseño arranca con la tarifa que tenía Administración", async () => {
    const orgs = (await db.query<{ organization_id: string; ids: string[] }>(
      "select organization_id, array_agg(id order by position) ids from hour_rates group by organization_id",
    )).rows;
    expect(orgs.length).toBeGreaterThan(0);
    for (const o of orgs) expect(o.ids).toEqual(["labor", "design", "admin"]);
  });

  it("Taller no ve las tarifas de Diseño ni de Administración", async () => {
    expect(await rows(juan, "select * from hour_rates where kind in ('design', 'admin')")).toHaveLength(0);
    const [{ ws }] = await rows(juan, "select taller_workspace() as ws");
    expect(JSON.stringify(ws)).not.toContain("design");
  });
});

describe("Lote 4c · jornada del operario y empresa demo", () => {
  it("la jornada se guarda con Gestión (9,5 h por defecto) y se valida entre 1 y 24", async () => {
    expect(Number((await rows(laura, "select hours_per_day from cost_settings"))[0].hours_per_day)).toBe(9.5);
    await asUser(db, laura, (tx) => tx.query("update cost_settings set hours_per_day = 8 where organization_id = $1", [org]));
    expect(Number((await rows(laura, "select hours_per_day from cost_settings"))[0].hours_per_day)).toBe(8);
    expect(await errorAs(db, laura, (tx) => tx.query("update cost_settings set hours_per_day = 30 where organization_id = $1", [org]))).toMatch(/check/);
  });

  it("Taller no lee cost_settings; desde el Lote 5B recibe solo su jornada (para avisar si se pasa), nada de costos", async () => {
    expect(await rows(juan, "select hours_per_day from cost_settings")).toHaveLength(0);
    const [{ ws }] = await rows(juan, "select taller_workspace() as ws");
    const text = JSON.stringify(ws);
    expect(text).toContain("hours_per_day");
    for (const k of ["overtime_multiplier", "financial_pct", "hourly_rate", "labor_valuation"]) expect(text).not.toContain(k);
  });

  it("la jornada usada queda en la línea de horas", async () => {
    const p = seed.projects.find((x) => x.status === "quotation")!;
    await asUser(db, laura, (tx) =>
      tx.query(
        "insert into budget_lines (organization_id, id, project_id, category, description, quantity, unit, unit_cost, total, hour_type, hours_per_day) values ($1, 'bl-j', $2, 'labor', 'x', 10, 'h', 19000, 190000, 'normal', 9.5)",
        [org, p.id],
      ),
    );
    expect(Number((await rows(laura, "select hours_per_day from budget_lines where id = 'bl-j'"))[0].hours_per_day)).toBe(9.5);
  });

  it("solo Gestión marca la empresa como demo", async () => {
    await asUser(db, laura, (tx) => tx.query("update organizations set is_demo = true where id = $1", [org]));
    expect((await rows(laura, "select is_demo from organizations"))[0].is_demo).toBe(true);
    expect(await rows(juan, "update organizations set is_demo = false where id = $1 returning id", [org])).toHaveLength(0);
  });
});
