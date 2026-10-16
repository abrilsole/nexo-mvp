// Lote 5C — Compras escribe solo con compras_save() y nunca lee importes de venta ni de mano de obra (PGlite).
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { buildSeed } from "@/lib/seed-data";
import { workspacePayload } from "@/lib/supabase/workspace";
import { asUser, createDb, errorAs, signUp } from "./harness";

let db: PGlite;
let org = "";
let laura = ""; // Administrativo
let martin = ""; // Compras
let carla = ""; // Jefe de planta
let juan = ""; // Operario
let otro = ""; // Administrativo de otra empresa

const today = new Date().toISOString().slice(0, 10);
const rows = async (userId: string, sql: string, params: unknown[] = []) =>
  asUser(db, userId, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);
const save = (userId: string, p: Record<string, unknown>) => asUser(db, userId, (tx) => tx.query("select compras_save($1::jsonb)", [JSON.stringify(p)]));
const saveError = (userId: string, p: Record<string, unknown>) => errorAs(db, userId, (tx) => tx.query("select compras_save($1::jsonb)", [JSON.stringify(p)]));

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

const purchase = { id: "pur_c1", project_id: "p-1053", material_id: "perfil-alu", material_name: "Perfil aluminio", quantity: 60, unit: "m", unit_cost: 15500, supplier: "Aluminios BA", date: today };

beforeAll(async () => {
  db = await createDb();
  laura = await signUp(db, "laura@demo.com", "Laura Gómez");
  org = (await db.query<{ organization_id: string }>("select organization_id from organization_members where user_id = $1", [laura])).rows[0].organization_id;
  const s = buildSeed(new Date());
  const payload = workspacePayload(org, { projects: s.projects, operators: s.operators, stock: s.stock, requests: [], assignments: [], lineStatuses: [], settings: { ...DEFAULT_SETTINGS }, resolvedAlertIds: [] });
  await asUser(db, laura, (tx) => tx.query("select reset_workspace($1::jsonb)", [JSON.stringify(payload)]));
  const inv = (p: Record<string, unknown>) => asUser(db, laura, (tx) => tx.query("select admin_invite_member($1::jsonb)", [JSON.stringify(p)]));
  await inv({ email: "martin@demo.com", display_name: "Martín Ruiz", role: "compras" });
  await inv({ email: "carla@demo.com", display_name: "Carla Sosa", role: "jefe_planta" });
  await inv({ email: "juan@demo.com", display_name: "Juan Pérez", role: "operator", operator_id: "op-juan" });
  martin = await signUp(db, "martin@demo.com", "Martín");
  carla = await signUp(db, "carla@demo.com", "Carla");
  juan = await signUp(db, "juan@demo.com", "Juan");
  otro = await signUp(db, "otro@empresa.com", "Otra persona");
}, 120_000);

describe("Compras registra compras reales", () => {
  it("guarda la compra con el precio pagado; el total lo calcula la base y queda a su nombre", async () => {
    await save(martin, { purchases: [{ ...purchase, total: 1 }] });
    const [r] = await rows(laura, "select total::text as total, unit_cost::text as cost, supplier, created_by from purchase_entries where id = 'pur_c1'");
    expect(r).toEqual({ total: "930000.00", cost: "15500", supplier: "Aluminios BA", created_by: "Martín Ruiz" });
  });
  it("con el lote de stock, su movimiento al proyecto, la bitácora y el estado 'comprado'", async () => {
    await save(martin, {
      lots: [{ id: "lot_c1", kind: "purchase", material_id: "perfil-alu", material_name: "Perfil aluminio", unit: "m", unit_cost: 15500, supplier: "Aluminios BA", purchase_entry_id: "pur_c1", origin_project_id: "p-1053", origin_project_name: "P-1053" }],
      movements: [{ id: "mov_c1", lot_id: "lot_c1", kind: "purchase_in", quantity: 60, from_place: { kind: "supplier" }, to_place: { kind: "project", projectId: "p-1053" }, date: today, project_id: "p-1053" }],
      activity: [{ id: "act_c1", project_id: "p-1053", kind: "purchase", message: "Compra de 60 m de Perfil aluminio." }],
      line_statuses: [{ project_id: "p-1053", line_id: "bl-0407", status: "purchased" }],
    });
    expect(await rows(laura, "select created_by from stock_lots where id = 'lot_c1'")).toEqual([{ created_by: "Martín Ruiz" }]);
    expect(await rows(laura, "select kind from stock_movements where id = 'mov_c1'")).toEqual([{ kind: "purchase_in" }]);
    expect(await rows(laura, "select status, updated_by from purchase_line_status where line_id = 'bl-0407'")).toEqual([{ status: "purchased", updated_by: "Martín Ruiz" }]);
  });
  it("el estado se puede cambiar (cotizando → recibido) y Administrativo también lo usa", async () => {
    await save(martin, { line_statuses: [{ project_id: "p-1053", line_id: "bl-0408", status: "quoting" }] });
    await save(laura, { line_statuses: [{ project_id: "p-1053", line_id: "bl-0407", status: "received" }] });
    expect(await rows(martin, "select line_id, status from purchase_line_status order by line_id")).toEqual([
      { line_id: "bl-0407", status: "received" },
      { line_id: "bl-0408", status: "quoting" },
    ]);
  });
  it("valida: precio y cantidad > 0, proyecto en ejecución, línea de materiales, sin consumo", async () => {
    expect(await saveError(martin, { purchases: [{ ...purchase, id: "pur_x", unit_cost: 0 }] })).toMatch(/mayores a cero/);
    expect(await saveError(martin, { purchases: [{ ...purchase, id: "pur_x", project_id: "p-1056" }] })).toMatch(/Cotización o cerrado/);
    expect(await saveError(martin, { purchases: [{ ...purchase, id: "pur_x", project_id: "p-0987" }] })).toMatch(/Cotización o cerrado/);
    expect(await saveError(martin, { line_statuses: [{ project_id: "p-1053", line_id: "bl-0410x", status: "quoting" }] })).toMatch(/Línea de materiales/);
    expect(await saveError(martin, { line_statuses: [{ project_id: "p-1053", line_id: "bl-0407", status: "perdido" }] })).toMatch(/Estado inválido/);
    expect(await saveError(martin, { movements: [{ id: "mov_x", lot_id: "lot_c1", kind: "consume", quantity: 1, from_place: { kind: "project", projectId: "p-1053" }, to_place: { kind: "consumed" }, date: today }] })).toMatch(/taller/);
  });
  it("un sobrante hereda el costo de su lote (no se puede inventar un costo)", async () => {
    await save(martin, { lots: [{ id: "lot_c2", kind: "leftover", parent_lot_id: "lot_c1", unit_cost: 1, origin_project_id: "p-1053" }] });
    expect(await rows(laura, "select unit_cost::text as c, material_id from stock_lots where id = 'lot_c2'")).toEqual([{ c: "15500", material_id: "perfil-alu" }]);
  });
});

describe("pedidos del taller", () => {
  it("Compras da por resuelto un pedido abierto (y no reabre uno cerrado)", async () => {
    await db.query(
      "insert into material_requests (organization_id, id, project_id, material_id, material_name, quantity, unit, requested_by) values ($1, 'req_c1', 'p-1042', 'mdf-18', 'MDF 18 mm', 2, 'placa', 'Juan')",
      [org],
    );
    await save(martin, { request_statuses: [{ id: "req_c1", status: "resolved" }] });
    await save(martin, { request_statuses: [{ id: "req_c1", status: "cancelled" }] });
    expect(await rows(laura, "select status, resolved_by from material_requests where id = 'req_c1'")).toEqual([{ status: "resolved", resolved_by: "Martín Ruiz" }]);
    expect(await saveError(martin, { request_statuses: [{ id: "req_c1", status: "open" }] })).toMatch(/Estado inválido/);
  });
});

describe("los demás roles no escriben con compras_save", () => {
  it("Jefe de planta y Operario: rechazado", async () => {
    for (const u of [carla, juan]) {
      expect(await saveError(u, { line_statuses: [{ project_id: "p-1053", line_id: "bl-0405", status: "quoting" }] })).toMatch(/Solo Compras o un usuario Administrativo/);
    }
  });
  it("otra empresa solo escribe en la suya: los proyectos de esta no existen para ella", async () => {
    expect(await saveError(otro, { line_statuses: [{ project_id: "p-1053", line_id: "bl-0405", status: "quoting" }] })).toMatch(/Línea de materiales no encontrada/);
    expect(await saveError(otro, { purchases: [{ ...purchase, id: "pur_y" }] })).toMatch(/Proyecto no encontrado/);
  });
  it("Compras dado de baja: rechazado", async () => {
    await db.query("update organization_members set deactivated_at = now() where user_id = $1", [martin]);
    expect(await saveError(martin, { line_statuses: [{ project_id: "p-1053", line_id: "bl-0405", status: "quoting" }] })).toMatch(/Solo Compras/);
    await db.query("update organization_members set deactivated_at = null where user_id = $1", [martin]);
  });
  it("Jefe de planta y Operario no leen los estados de línea; Compras no lee las tablas con importes", async () => {
    expect(await rows(carla, "select * from purchase_line_status")).toHaveLength(0);
    expect(await rows(juan, "select * from purchase_line_status")).toHaveLength(0);
    expect(await rows(martin, "select * from purchase_entries")).toHaveLength(0);
    expect(await rows(martin, "select * from projects")).toHaveLength(0);
    expect(await rows(martin, "select * from budget_lines")).toHaveLength(0);
  });
});

describe("lo que lee Compras", () => {
  it("estados de línea y umbrales de alertas; nunca precio de venta, mano de obra ni rentabilidad", async () => {
    const [{ r: ws }] = await rows(martin, "select compras_workspace() as r");
    const w = ws as { line_statuses: unknown[]; alert_settings: unknown; budget_lines: { category: string }[]; projects: Record<string, unknown>[] };
    expect(w.line_statuses).toHaveLength(2);
    expect(w.alert_settings).not.toBeUndefined();
    expect(w.budget_lines.every((l) => l.category === "materials")).toBe(true);
    const keys = keysDeep(w);
    for (const k of ["sales_price", "baseline", "progress_percent", "hourly_cost", "hourly_rate", "actual_entries", "labor"]) expect(keys.has(k), k).toBe(false);
  });
});
