// Lote 6 · Fase 3 — días laborales y excepciones en la base (PGlite): los edita el Jefe de planta (o Administrativo)
// con planta_save_schedule; Operario y Compras no; las excepciones quitadas quedan marcadas, no se borran.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { buildSeed } from "@/lib/seed-data";
import { workspacePayload, scheduleParams } from "@/lib/supabase/workspace";
import { asUser, createDb, errorAs, signUp } from "./harness";

let db: PGlite;
let org = "";
let laura = "";
let carla = "";
let juan = "";
let martin = "";
let otro = "";

const seed = buildSeed(new Date());
const rows = async (userId: string, sql: string) => asUser(db, userId, async (tx) => (await tx.query<Record<string, unknown>>(sql)).rows);
const save = (userId: string, p: Record<string, unknown>) => asUser(db, userId, (tx) => tx.query("select planta_save_schedule($1::jsonb)", [JSON.stringify(p)]));
const fail = (userId: string, p: Record<string, unknown>) => errorAs(db, userId, (tx) => tx.query("select planta_save_schedule($1::jsonb)", [JSON.stringify(p)]));

beforeAll(async () => {
  db = await createDb();
  laura = await signUp(db, "laura@demo.com", "Laura Gómez");
  org = (await db.query<{ organization_id: string }>("select organization_id from organization_members where user_id = $1", [laura])).rows[0].organization_id;
  const payload = workspacePayload(org, { projects: seed.projects, operators: seed.operators, stock: seed.stock, requests: [], assignments: [], orders: [], settings: { ...DEFAULT_SETTINGS }, resolvedAlertIds: [] });
  await asUser(db, laura, (tx) => tx.query("select reset_workspace($1::jsonb)", [JSON.stringify(payload)]));
  const inv = (p: Record<string, unknown>) => asUser(db, laura, (tx) => tx.query("select admin_invite_member($1::jsonb)", [JSON.stringify(p)]));
  await inv({ email: "carla@demo.com", display_name: "Carla Sosa", role: "jefe_planta" });
  await inv({ email: "juan@demo.com", display_name: "Juan Pérez", role: "operator", operator_id: "op-juan" });
  await inv({ email: "martin@demo.com", display_name: "Martín Ruiz", role: "compras" });
  carla = await signUp(db, "carla@demo.com", "Carla");
  juan = await signUp(db, "juan@demo.com", "Juan");
  martin = await signUp(db, "martin@demo.com", "Martín");
  otro = await signUp(db, "otro@empresa.com", "Otra persona");
}, 120_000);

describe("días laborales", () => {
  it("vienen del seed (Sofía lunes a jueves) y el resto sin dato (lunes a viernes)", async () => {
    expect(await rows(laura, "select id, work_days from operators where id in ('op-sofia', 'op-juan') order by id")).toEqual([
      { id: "op-juan", work_days: null },
      { id: "op-sofia", work_days: [1, 2, 3, 4] },
    ]);
  });
  it("el Jefe de planta cambia los días y agrega excepciones (a su nombre)", async () => {
    await save(carla, scheduleParams("op-juan", { workDays: [1, 2, 3, 4, 5, 6], add: [{ date: "2026-12-05", works: false, note: "Feriado puente" }, { date: "2026-12-06", works: true, hours: 4 }] }));
    expect(await rows(laura, "select work_days from operators where id = 'op-juan'")).toEqual([{ work_days: [1, 2, 3, 4, 5, 6] }]);
    expect(await rows(carla, "select date::text as d, works, hours::float as h, note, created_by from operator_day_exceptions where operator_id = 'op-juan' order by date")).toEqual([
      { d: "2026-12-05", works: false, h: null, note: "Feriado puente", created_by: "Carla Sosa" },
      { d: "2026-12-06", works: true, h: 4, note: null, created_by: "Carla Sosa" },
    ]);
  });
  it("quitar una excepción la marca (no se borra) y volver a ponerla la reactiva", async () => {
    await save(carla, scheduleParams("op-juan", { remove: ["2026-12-05"] }));
    expect(await rows(laura, "select (removed_at is not null) as quitada from operator_day_exceptions where date = '2026-12-05'")).toEqual([{ quitada: true }]);
    const [{ r }] = await rows(carla, "select planta_workspace() as r");
    expect((r as { day_exceptions: Array<{ date: string }> }).day_exceptions.map((x) => x.date)).toEqual(["2026-12-06"]);
    await save(laura, scheduleParams("op-juan", { add: [{ date: "2026-12-05", works: false }] }));
    expect(await rows(laura, "select (removed_at is null) as vigente from operator_day_exceptions where date = '2026-12-05'")).toEqual([{ vigente: true }]);
  });
  it("valida días, horas y operario", async () => {
    expect(await fail(carla, scheduleParams("op-juan", { workDays: [7] }))).toMatch(/inválido|check/);
    expect(await fail(carla, scheduleParams("op-juan", { add: [{ date: "2026-12-07", works: true, hours: 30 }] }))).toMatch(/0 a 24/);
    expect(await fail(carla, scheduleParams("op-nadie", { workDays: [1] }))).toMatch(/Operario no encontrado/);
  });
});

describe("quién puede", () => {
  it("Operario y Compras no editan días ni leen las excepciones", async () => {
    for (const u of [juan, martin]) {
      expect(await fail(u, scheduleParams("op-juan", { workDays: [1] }))).toMatch(/Solo el Jefe de planta o un usuario Administrativo/);
      expect(await rows(u, "select * from operator_day_exceptions")).toHaveLength(0);
    }
  });
  it("nadie escribe directo en la tabla (solo por la función)", async () => {
    const err = await errorAs(db, carla, (tx) => tx.query("insert into operator_day_exceptions (organization_id, operator_id, date, works) values ($1, 'op-juan', '2026-12-10', true)", [org]));
    expect(err).toMatch(/row-level security|permission/);
  });
  it("otra empresa no ve ni toca los operarios de esta", async () => {
    expect(await fail(otro, scheduleParams("op-juan", { workDays: [1] }))).toMatch(/Operario no encontrado/);
    expect(await rows(otro, "select * from operator_day_exceptions")).toHaveLength(0);
  });
  it("el Jefe recibe días y excepciones sin costos", async () => {
    const [{ r }] = await rows(carla, "select planta_workspace() as r");
    const w = r as { operators: Array<Record<string, unknown>> };
    expect(w.operators.find((o) => o.id === "op-sofia")?.work_days).toEqual([1, 2, 3, 4]);
    expect(w.operators.every((o) => !("hourly_cost" in o))).toBe(true);
  });
});
