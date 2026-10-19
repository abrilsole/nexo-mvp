// Compras (Lote 6) — órdenes de compra en la base (PGlite): número correlativo, Borrador → Enviada → Facturada, la
// factura crea el costo real, la recepción crea el stock y cambia el estado de materiales, el stock es solo consulta
// para Compras, y Compras nunca lee precio de venta, rentabilidad ni mano de obra.
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
const seed = buildSeed(new Date());
/** Líneas de materiales de P-1051 (aprobado, sin compras). */
const LINES = seed.projects.find((p) => p.id === "p-1051")!.budgetLines.filter((l) => l.category === "materials" && l.quantity !== null);
const rows = async (userId: string, sql: string, params: unknown[] = []) =>
  asUser(db, userId, async (tx) => (await tx.query<Record<string, unknown>>(sql, params)).rows);
const call = (userId: string, fn: string, p: Record<string, unknown>) => asUser(db, userId, (tx) => tx.query(`select ${fn}($1::jsonb) as r`, [JSON.stringify(p)]));
const fail = (userId: string, fn: string, p: Record<string, unknown>) => errorAs(db, userId, (tx) => tx.query(`select ${fn}($1::jsonb)`, [JSON.stringify(p)]));
const lineOf = (l: (typeof LINES)[number], id: string, quantity = l.quantity ?? 0) => ({
  id,
  project_id: "p-1051",
  budget_line_id: l.id,
  material_id: l.materialId ?? null,
  material_name: l.description,
  unit: l.unit,
  quantity,
  unit_cost: Math.round(l.unitCost * 1.1),
});
const materialsState = async () => {
  const [{ r }] = await rows(carla, "select planta_workspace() as r");
  return (r as { projects: Array<{ id: string; materials_state: string | null }> }).projects.find((p) => p.id === "p-1051")!.materials_state;
};

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

beforeAll(async () => {
  db = await createDb();
  laura = await signUp(db, "laura@demo.com", "Laura Gómez");
  org = (await db.query<{ organization_id: string }>("select organization_id from organization_members where user_id = $1", [laura])).rows[0].organization_id;
  const payload = workspacePayload(org, { projects: seed.projects, operators: seed.operators, stock: seed.stock, requests: [], assignments: [], orders: [], settings: { ...DEFAULT_SETTINGS }, resolvedAlertIds: [] });
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

describe("órdenes de compra", () => {
  it("sin nada pedido, el estado de materiales del proyecto es 'Sin comprar'", async () => {
    expect(await materialsState()).toBe("none");
  });

  it("Compras crea la orden en Borrador con número correlativo (OC-0001, OC-0002) y a su nombre", async () => {
    const [first, ...rest] = LINES;
    await call(martin, "compras_order_save", { id: "oc_a", supplier: "Maderera Oeste", date: today, lines: [lineOf(first, "ocl_a1")] });
    await call(martin, "compras_order_save", { id: "oc_b", supplier: "Herrajes Sur", date: today, lines: rest.map((l, i) => lineOf(l, `ocl_b${i}`)) });
    expect(await rows(laura, "select id, number, status, paid, received, created_by from purchase_orders order by number")).toEqual([
      { id: "oc_a", number: "OC-0001", status: "draft", paid: false, received: "no", created_by: "Martín Ruiz" },
      { id: "oc_b", number: "OC-0002", status: "draft", paid: false, received: "no", created_by: "Martín Ruiz" },
    ]);
    // Pedido, pero sin factura no hay costo real.
    expect(await rows(laura, "select * from purchase_entries where project_id = 'p-1051'")).toHaveLength(0);
    expect(await materialsState()).toBe("on_the_way");
  });

  it("valida proveedor, materiales de proyectos aprobados y cantidades/costos > 0", async () => {
    const l = lineOf(LINES[0], "ocl_x");
    expect(await fail(martin, "compras_order_save", { id: "oc_x", supplier: " ", date: today, lines: [l] })).toMatch(/proveedor/);
    expect(await fail(martin, "compras_order_save", { id: "oc_x", supplier: "X", date: today, lines: [] })).toMatch(/al menos un material/);
    expect(await fail(martin, "compras_order_save", { id: "oc_x", supplier: "X", date: today, lines: [{ ...l, unit_cost: 0 }] })).toMatch(/mayores a cero/);
    expect(await fail(martin, "compras_order_save", { id: "oc_x", supplier: "X", date: today, lines: [{ ...l, project_id: "p-1056" }] })).toMatch(/proyecto aprobado/);
    expect(await fail(martin, "compras_order_save", { id: "oc_x", supplier: "X", date: today, lines: [{ ...l, budget_line_id: "bl-no-existe" }] })).toMatch(/proyecto aprobado/);
  });

  it("Borrador → Enviada → Facturada; no se saltea pasos ni se edita lo enviado", async () => {
    expect(await fail(martin, "compras_order_status", { id: "oc_a", action: "invoice", invoice_number: "A-1", invoice_amount: 100, invoice_date: today })).toMatch(/Enviada/);
    expect(await fail(martin, "compras_order_status", { id: "oc_a", action: "receive", receipts: [] })).toMatch(/enviá/);
    await call(martin, "compras_order_status", { id: "oc_a", action: "send" });
    expect(await fail(martin, "compras_order_save", { id: "oc_a", supplier: "Otro", date: today, lines: [lineOf(LINES[0], "ocl_a1")] })).toMatch(/Borrador/);
    expect(await fail(martin, "compras_order_status", { id: "oc_a", action: "paid", paid: true })).toMatch(/Facturada/);
    expect(await fail(martin, "compras_order_status", { id: "oc_a", action: "invoice", invoice_number: " ", invoice_amount: 100, invoice_date: today })).toMatch(/número, monto y fecha/);
  });

  it("registrar la factura crea el costo real del proyecto (con proveedor y nota); marcar pagada no lo cambia", async () => {
    const l = lineOf(LINES[0], "ocl_a1");
    await call(martin, "compras_order_status", { id: "oc_a", action: "invoice", invoice_number: "A-0001-00000123", invoice_amount: l.quantity * l.unit_cost, invoice_date: today });
    const real = async () => rows(laura, "select id, unit_cost::float as cost, total::float as total, supplier, notes, created_by from purchase_entries where project_id = 'p-1051'");
    const before = await real();
    expect(before).toEqual([{ id: "pur-ocl_a1", cost: l.unit_cost, total: l.quantity * l.unit_cost, supplier: "Maderera Oeste", notes: "OC-0001 · factura A-0001-00000123", created_by: "Martín Ruiz" }]);
    expect(await rows(laura, "select status, invoice_number from purchase_orders where id = 'oc_a'")).toEqual([{ status: "invoiced", invoice_number: "A-0001-00000123" }]);
    await call(martin, "compras_order_status", { id: "oc_a", action: "paid", paid: true });
    expect(await rows(laura, "select paid from purchase_orders where id = 'oc_a'")).toEqual([{ paid: true }]);
    expect(await real()).toEqual(before);
  });

  it("recibir en partes: crea el lote al costo real y lo mueve al proyecto; parcial → recibida", async () => {
    const l = lineOf(LINES[0], "ocl_a1");
    const half = Math.floor(l.quantity / 2);
    await call(martin, "compras_order_status", { id: "oc_a", action: "receive", receipts: [{ line_id: "ocl_a1", quantity: half, lot_id: "lot_r1", movement_id: "mov_r1" }] });
    expect(await rows(laura, "select received from purchase_orders where id = 'oc_a'")).toEqual([{ received: "partial" }]);
    expect(await rows(laura, "select unit_cost::float as cost, supplier, purchase_entry_id from stock_lots where id = 'lot_r1'")).toEqual([{ cost: l.unit_cost, supplier: "Maderera Oeste", purchase_entry_id: "pur-ocl_a1" }]);
    expect(await rows(laura, "select kind, quantity::float as q, to_place from stock_movements where id = 'mov_r1'")).toEqual([{ kind: "purchase_in", q: half, to_place: { type: "project", projectId: "p-1051" } }]);
    expect(await fail(martin, "compras_order_status", { id: "oc_a", action: "receive", receipts: [{ line_id: "ocl_a1", quantity: l.quantity, lot_id: "lot_r9", movement_id: "mov_r9" }] })).toMatch(/más de lo pedido/);
    await call(martin, "compras_order_status", { id: "oc_a", action: "receive", receipts: [{ line_id: "ocl_a1", quantity: l.quantity - half, lot_id: "lot_r2", movement_id: "mov_r2" }] });
    expect(await rows(laura, "select received from purchase_orders where id = 'oc_a'")).toEqual([{ received: "yes" }]);
  });

  it("recibir todo (o asignarlo desde el depósito) cambia el estado de materiales a 'Completo'", async () => {
    const last = LINES[LINES.length - 1];
    // OC-0002: se recibe todo menos una línea, que se cubre con stock del depósito.
    await call(martin, "compras_order_status", { id: "oc_b", action: "send" });
    const others = LINES.slice(1);
    const receipts = others
      .map((l, i) => ({ l, line_id: `ocl_b${i}` }))
      .filter((x) => x.l.id !== last.id)
      .map((x, i) => ({ line_id: x.line_id, quantity: x.l.quantity, lot_id: `lot_b${i}`, movement_id: `mov_b${i}` }));
    await call(martin, "compras_order_status", { id: "oc_b", action: "receive", receipts });
    expect(await materialsState()).toBe("on_the_way");
    await db.query("insert into stock_lots (organization_id, id, material_id, material_name, unit, unit_cost, kind, created_by) values ($1, 'lot_dep', $2, $3, $4, 1, 'opening', 'Laura')", [
      org,
      last.materialId,
      last.description,
      last.unit,
    ]);
    await db.query(`insert into stock_movements(organization_id,id,lot_id,kind,quantity,from_place,to_place,date,created_by)
      values($1,'opening-dep','lot_dep','opening',$2,'{"type":"supplier"}','{"type":"warehouse"}',current_date,'Laura')`,[org,last.quantity]);
    await db.query(
      `insert into stock_movements (organization_id, id, lot_id, kind, quantity, from_place, to_place, date, created_by)
       values ($1, 'mov_dep', 'lot_dep', 'assign', $2, '{"type":"warehouse"}', jsonb_build_object('type', 'project', 'projectId', 'p-1051'), current_date, 'Laura')`,
      [org, last.quantity],
    );
    expect(await materialsState()).toBe("complete");
  });
});

describe("Stock: solo consulta para Compras (en la base)", () => {
  it("compras_save ya no acepta compras, lotes, movimientos ni bitácora", async () => {
    for (const p of [
      { purchases: [{ id: "pur_x", project_id: "p-1051", material_name: "X", quantity: 1, unit: "u", unit_cost: 1, date: today }] },
      { lots: [{ id: "lot_x", kind: "purchase", material_id: "x", material_name: "X", unit: "u", unit_cost: 1 }] },
      { movements: [{ id: "mov_x", lot_id: "lot_r1", kind: "transfer", quantity: 1, from_place: { type: "warehouse" }, to_place: { type: "warehouse" }, date: today }] },
      { activity: [{ id: "act_x", project_id: "p-1051", kind: "purchase", message: "x" }] },
    ]) {
      expect(await fail(martin, "compras_save", p)).toMatch(/solo consulta/);
    }
  });
  it("tampoco escribe directo en las tablas de stock (RLS)", async () => {
    const err = await errorAs(db, martin, (tx) =>
      tx.query("insert into stock_lots (organization_id, id, material_id, material_name, unit, unit_cost, kind, created_by) values ($1, 'lot_hack', 'x', 'X', 'u', 1, 'opening', 'M')", [org]),
    );
    expect(err).toMatch(/row-level security/);
    await asUser(db, martin, (tx) => tx.query("update stock_lots set unit_cost = 0 where id = 'lot_r1'"));
    expect(await rows(laura, "select unit_cost::float as c from stock_lots where id = 'lot_r1'")).toEqual([{ c: lineOf(LINES[0], "x").unit_cost }]);
  });
  it("pero lo lee (por compras_workspace): ve los lotes y sus movimientos", async () => {
    const [{ r }] = await rows(martin, "select compras_workspace() as r");
    const w = r as { stock_lots: Array<{ id: string }>; stock_movements: Array<{ id: string }> };
    expect(w.stock_lots.some((l) => l.id === "lot_r1")).toBe(true);
    expect(w.stock_movements.some((m) => m.id === "mov_r1")).toBe(true);
  });
});

describe("los demás roles no usan las órdenes de compra", () => {
  it("Jefe de planta y Operario: rechazado y no leen las órdenes", async () => {
    for (const u of [carla, juan]) {
      expect(await fail(u, "compras_order_save", { id: "oc_y", supplier: "X", date: today, lines: [lineOf(LINES[0], "ocl_y")] })).toMatch(/Solo Compras o un usuario Administrativo/);
      expect(await fail(u, "compras_order_status", { id: "oc_b", action: "send" })).toMatch(/Solo Compras o un usuario Administrativo/);
      expect(await rows(u, "select * from purchase_orders")).toHaveLength(0);
      expect(await rows(u, "select * from purchase_order_lines")).toHaveLength(0);
    }
  });
  it("otra empresa: las órdenes y proyectos de esta no existen para ella", async () => {
    expect(await fail(otro, "compras_order_status", { id: "oc_b", action: "send" })).toMatch(/Orden no encontrada/);
    expect(await fail(otro, "compras_order_save", { id: "oc_z", supplier: "X", date: today, lines: [lineOf(LINES[0], "ocl_z")] })).toMatch(/proyecto aprobado/);
    expect(await rows(otro, "select * from purchase_orders")).toHaveLength(0);
  });
  it("el Jefe ve el estado de materiales, sin importes de compras", async () => {
    const [{ r }] = await rows(carla, "select planta_workspace() as r");
    const keys = keysDeep(r);
    for (const k of ["unit_cost", "invoice_amount", "sales_price", "hourly_cost", "purchase_orders"]) expect(keys.has(k), k).toBe(false);
  });
});

describe("lo que lee Compras", () => {
  it("órdenes, líneas de materiales y umbrales; nunca precio de venta, mano de obra ni rentabilidad", async () => {
    const [{ r: ws }] = await rows(martin, "select compras_workspace() as r");
    const w = ws as { purchase_orders: Array<{ number: string; lines: unknown[] }>; alert_settings: unknown; budget_lines: { category: string }[] };
    expect(w.purchase_orders.map((o) => o.number).sort()).toEqual(["OC-0001", "OC-0002"]);
    expect(w.alert_settings).not.toBeUndefined();
    expect(w.budget_lines.every((l) => l.category === "materials")).toBe(true);
    const keys = keysDeep(w);
    for (const k of ["sales_price", "baseline", "progress_percent", "hourly_cost", "hourly_rate", "actual_entries", "labor"]) expect(keys.has(k), k).toBe(false);
  });
  it("y no lee las tablas con importes de venta ni de mano de obra", async () => {
    expect(await rows(martin, "select * from projects")).toHaveLength(0);
    expect(await rows(martin, "select * from actual_entries")).toHaveLength(0);
  });
});

describe("restaurar la demo", () => {
  it("las órdenes de la demo vuelven a su estado; las anteriores quedan sin líneas (la app no las muestra) y nada se borra", async () => {
    const payload = workspacePayload(org, { projects: seed.projects, operators: seed.operators, stock: seed.stock, requests: [], assignments: [], orders: [], settings: { ...DEFAULT_SETTINGS }, resolvedAlertIds: [] });
    await asUser(db, laura, (tx) => tx.query("select reset_workspace($1::jsonb)", [JSON.stringify(payload)]));
    const { orderSeedRows } = await import("@/lib/supabase/mappers");
    await call(laura, "compras_load_orders", orderSeedRows(seed.orders));
    const withLines = await rows(laura, "select o.number from purchase_orders o where exists (select 1 from purchase_order_lines l where l.order_id = o.id) order by o.number");
    expect(withLines.map((r) => r.number)).toEqual(["OC-0001", "OC-0002", "OC-0003"]);
    expect(await rows(laura, "select status, received from purchase_orders where number = 'OC-0003'")).toEqual([{ status: "draft", received: "no" }]);
    // Las anteriores siguen (sin líneas): la próxima orden continúa la numeración, sin repetir.
    const [{ r: id }] = await asUser(db, martin, async (tx) => (await tx.query<{ r: string }>("select compras_order_save($1::jsonb) as r", [JSON.stringify({ id: "oc_new", supplier: "X", date: today, lines: [lineOf(LINES[0], "ocl_new")] })])).rows);
    expect(id).toBe("oc_new");
    const [{ number }] = await rows(laura, "select number from purchase_orders where id = 'oc_new'");
    expect(number).not.toMatch(/^OC-000[123]$/);
  });
});
