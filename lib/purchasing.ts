// ─────────────────────────────────────────────────────────────
// Compras (Lotes 5C y 6) — funciones puras.
// Trabajan SOLO con materiales: costo unitario ESTIMADO (lo carga el Administrativo, de memoria), costo REAL
// (el de la factura de la orden de compra), proveedor y fechas. Nunca precio de venta, rentabilidad ni mano de obra.
// Distinguen siempre compra (factura), consumo, desperdicio y sobrante reutilizable (ver lib/material-reconciliation.ts).
// ─────────────────────────────────────────────────────────────
import type { ActivityEvent, Alert, AlertLevel, AlertSettings, OrderReceived, Project, PurchaseEntry, PurchaseOrder, PurchaseOrderLine } from "@/types";
import { receiveStock, warehouseHoldings, type StockChange, type StockCtx, type StockState } from "./stock";
import { alertBase, alertResolutionKey, sortAlerts } from "./alerts";
import { materialBudgetQuantity, type QuoteMaterial } from "./budget-calculator";
import { daysBetween, formatCurrency, formatDate, formatNumber, formatQty } from "./formatting";
import { materialKey } from "./material-reconciliation";
import { addDays } from "./plant";

const EPS = 1e-6;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Necesidades de compra ─────────────────────────────────────

/** Estado de una necesidad: se deriva de las órdenes de compra y de las compras directas. */
export type NeedStatus = "to_buy" | "ordered" | "received";

export const NEED_STATUS_LABELS: Record<NeedStatus, string> = {
  to_buy: "Por comprar",
  ordered: "En orden de compra",
  received: "Recibido",
};

export interface MaterialNeed {
  projectId: string;
  projectCode: string;
  projectName: string;
  /** Línea de materiales del costo presupuestado. */
  lineId: string;
  key: string;
  materialId?: string;
  description: string;
  unit: string;
  needed: number;
  /** Costo unitario ESTIMADO por el Administrativo al crear el proyecto (de memoria, no real). */
  estimatedUnitCost: number;
  estimatedTotal: number;
  /** En órdenes de compra (cualquier estado). */
  ordered: number;
  /** Recibido de esas órdenes. */
  receivedFromOrders: number;
  /** Compras directas anteriores (sin orden): ya están en el proyecto. */
  direct: number;
  /** Asignado desde el depósito al proyecto (Stock → Asignar; neto de lo devuelto): ya está en el proyecto. */
  fromDepot: number;
  /** Stock libre del depósito que alcanzaría para cubrir lo que falta (sugerencia: no se mueve solo). */
  fromStock: number;
  /** Lo que falta pedir: necesario − en órdenes − compras directas − asignado del depósito − stock libre. */
  toBuy: number;
  status: NeedStatus;
  orders: Array<{ orderId: string; number: string; quantity: number; received: number }>;
  /** Para cuándo se necesita: el inicio del proyecto (supuesto, ver docs/COMPRAS.md). */
  needBy: string;
  daysLeft: number;
}

/** Ids de las compras reales que salieron de una factura de orden ("pur-" + línea). */
export const orderEntryId = (line: Pick<PurchaseOrderLine, "id">) => `pur-${line.id}`;

/**
 * Lista de necesidades: los materiales (con cantidad) de los proyectos aprobados y abiertos, con lo que ya está en
 * órdenes, lo recibido, las compras directas anteriores y el stock libre del depósito (asignado por orden de inicio).
 */
export function materialNeeds(projects: Project[], orders: PurchaseOrder[], stock: StockState, today: string): MaterialNeed[] {
  const lines = orders.flatMap((o) => o.lines.map((l) => ({ o, l })));
  const fromOrders = new Set(lines.map(({ l }) => orderEntryId(l)));
  const free = new Map<string, number>();
  for (const h of warehouseHoldings(stock)) free.set(h.lot.materialId, (free.get(h.lot.materialId) ?? 0) + h.quantity);
  // Asignado del depósito a cada proyecto (asignar − devolver), por material.
  const lotKey = new Map(stock.lots.map((l) => [l.id, materialKey(l.materialId, l.materialName)]));
  const depot = new Map<string, number>();
  for (const m of stock.movements) {
    const sign = m.kind === "assign" ? 1 : m.kind === "release" ? -1 : 0;
    const place = m.kind === "assign" ? m.to : m.from;
    if (sign === 0 || place.type !== "project") continue;
    const k = `${place.projectId}|${lotKey.get(m.lotId) ?? ""}`;
    depot.set(k, (depot.get(k) ?? 0) + sign * m.quantity);
  }
  const raw = projects
    .filter((p) => !p.isClosed && p.status !== "quotation")
    .flatMap((p) => {
      const direct = new Map<string, number>();
      for (const e of p.purchaseEntries) {
        if (fromOrders.has(e.id)) continue;
        const k = materialKey(e.materialId, e.materialName);
        direct.set(k, (direct.get(k) ?? 0) + e.quantity);
      }
      return p.budgetLines
        .filter((l) => l.category === "materials" && l.quantity !== null)
        .map((l) => {
          const mine = lines.filter(({ l: ol }) => ol.projectId === p.id && ol.budgetLineId === l.id);
          const key = materialKey(l.materialId, l.description);
          return {
            p,
            l,
            key,
            ordered: round2(mine.reduce((s, x) => s + x.l.quantity, 0)),
            receivedFromOrders: round2(mine.reduce((s, x) => s + x.l.receivedQuantity, 0)),
            direct: round2(direct.get(key) ?? 0),
            fromDepot: round2(Math.max(0, depot.get(`${p.id}|${key}`) ?? 0)),
            orders: mine.map(({ o, l: ol }) => ({ orderId: o.id, number: o.number, quantity: ol.quantity, received: ol.receivedQuantity })),
          };
        });
    })
    .sort((a, b) => a.p.startDate.localeCompare(b.p.startDate) || a.p.code.localeCompare(b.p.code));
  return raw.map(({ p, l, key, ordered, receivedFromOrders, direct, fromDepot, orders: os }): MaterialNeed => {
    const needed = l.quantity ?? 0;
    const missing = Math.max(0, needed - ordered - direct - fromDepot);
    const fromStock = round2(Math.min(missing, free.get(key) ?? 0));
    free.set(key, (free.get(key) ?? 0) - fromStock);
    const received = receivedFromOrders + direct + fromDepot;
    const status: NeedStatus = received + EPS >= needed ? "received" : ordered > 0 ? "ordered" : "to_buy";
    return {
      projectId: p.id,
      projectCode: p.code,
      projectName: p.name,
      lineId: l.id,
      key,
      materialId: l.materialId,
      description: l.description,
      unit: l.unit,
      needed,
      estimatedUnitCost: l.unitCost,
      estimatedTotal: l.total,
      ordered,
      receivedFromOrders,
      direct,
      fromDepot,
      fromStock,
      toBuy: round2(missing - fromStock),
      status,
      orders: os,
      needBy: p.startDate,
      daysLeft: daysBetween(today, p.startDate),
    };
  });
}

/** Lo que hay que pedir: necesidades con algo por comprar, primero lo que se necesita antes. */
export const needsToBuy = (needs: MaterialNeed[]) => needs.filter((n) => n.toBuy > EPS);

/** Qué hay que comprar en los próximos `days` días (o ya se necesitaba). */
export function toBuyWithin(needs: MaterialNeed[], today: string, days: number): MaterialNeed[] {
  const limit = addDays(today, days);
  return needsToBuy(needs).filter((n) => n.needBy <= limit);
}

// ── Estado de materiales del proyecto ─────────────────────────

export type MaterialsState = "none" | "on_the_way" | "complete";

export const MATERIALS_STATE_LABELS: Record<MaterialsState, string> = { none: "Sin comprar", on_the_way: "En camino", complete: "Completo" };

/**
 * Sin comprar = nada pedido ni recibido · Completo = todo recibido · En camino = el resto.
 * null si el proyecto no tiene materiales con cantidad (los montos directos son servicios, no se reciben).
 */
export function materialsState(needs: MaterialNeed[], projectId: string): MaterialsState | null {
  const mine = needs.filter((n) => n.projectId === projectId);
  if (mine.length === 0) return null;
  if (mine.every((n) => n.status === "received")) return "complete";
  if (mine.every((n) => n.ordered === 0 && n.direct === 0 && n.fromDepot === 0)) return "none";
  return "on_the_way";
}

// ── Costo de materiales: estimado vs real ─────────────────────

export interface CostSource {
  entryId: string;
  /** "OC-0001 · factura A-123" o "Compra directa". */
  label: string;
  supplier?: string;
  date: string;
  quantity: number;
  unitCost: number;
  total: number;
}

export interface MaterialCostRow {
  lineId: string;
  description: string;
  unit: string;
  estimatedQuantity: number | null;
  estimatedUnitCost: number;
  estimated: number;
  /** Compras reales (facturas de órdenes y compras directas) de ese material en el proyecto. */
  real: number;
  diff: number;
  sources: CostSource[];
}

/**
 * Materiales del proyecto: estimado (presupuesto) contra real (lo FACTURADO; "Pagada" no cambia el costo).
 * Cada importe real se abre hasta la factura y la orden de compra que lo generan.
 */
export function materialCosts(
  project: Project,
  orders: PurchaseOrder[],
): { rows: MaterialCostRow[]; estimated: number; real: number; diff: number; pendingEstimated: number } {
  const byEntry = new Map(orders.flatMap((o) => o.lines.map((l) => [orderEntryId(l), o] as const)));
  const sourceOf = (e: PurchaseEntry): CostSource => {
    const o = byEntry.get(e.id);
    return {
      entryId: e.id,
      label: o ? `${o.number} · factura ${o.invoiceNumber ?? "—"}` : "Compra directa",
      supplier: e.supplier,
      date: e.date,
      quantity: e.quantity,
      unitCost: e.unitCost,
      total: e.total,
    };
  };
  const materialLines = project.budgetLines.filter(l=>l.category === "materials");
  const byLine = new Map(orders.flatMap(o=>o.lines.map(l=>[orderEntryId(l),l] as const)));
  const rows = materialLines.map((l): MaterialCostRow => {
      const key = materialKey(l.materialId, l.description);
      const sources = project.purchaseEntries.filter((e) => {
        const line = byLine.get(e.id);
        if (line) return line.projectId === project.id && line.budgetLineId === l.id;
        // Compra directa sin línea: mostrar una sola vez, junto a la primera línea del material.
        return materialKey(e.materialId,e.materialName) === key && materialLines.find(x=>materialKey(x.materialId,x.description) === key)?.id === l.id;
      }).map(sourceOf);
      const real = round2(sources.reduce((s, x) => s + x.total, 0));
      return { lineId: l.id, description: l.description, unit: l.unit, estimatedQuantity: l.quantity, estimatedUnitCost: l.unitCost, estimated: l.total, real, diff: round2(real - l.total), sources };
    });
  const estimated = round2(rows.reduce((s, r) => s + r.estimated, 0));
  const linked = new Set(rows.flatMap(r=>r.sources.map(x=>x.entryId)));
  const unmatched = project.purchaseEntries.filter(e=>!linked.has(e.id));
  for (const e of unmatched) rows.push({ lineId:`purchase:${e.id}`,description:`${e.materialName} (sin línea presupuestada)`,unit:e.unit,estimatedQuantity:null,estimatedUnitCost:0,estimated:0,real:e.total,diff:e.total,sources:[sourceOf(e)] });
  const real = round2(rows.reduce((s, r) => s + r.real, 0));
  // La diferencia se mide solo en lo ya facturado: comparar contra el estimado de lo que falta facturar engañaría.
  const billed = rows.filter((r) => r.real > 0);
  return {
    rows,
    estimated,
    real,
    diff: round2(billed.reduce((s, r) => s + r.diff, 0)),
    pendingEstimated: round2(rows.filter((r) => r.real === 0).reduce((s, r) => s + r.estimated, 0)),
  };
}

// ── Órdenes de compra ─────────────────────────────────────────

export const ORDER_STATUS_LABELS: Record<PurchaseOrder["status"], string> = { draft: "Borrador", sent: "Enviada", invoiced: "Facturada" };
export const ORDER_RECEIVED_LABELS: Record<OrderReceived, string> = { no: "No", partial: "Parcial", yes: "Sí" };

export const orderTotal = (o: Pick<PurchaseOrder, "lines">) => round2(o.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0));

export interface OrderDraft {
  supplier: string;
  date: string;
  notes?: string;
  lines: Array<Pick<PurchaseOrderLine, "projectId" | "budgetLineId" | "materialId" | "materialName" | "unit" | "quantity" | "unitCost">>;
}

export function orderDraftError(d: OrderDraft): string | null {
  if (!d.supplier.trim()) return "Indicá el proveedor elegido.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "Indicá la fecha de la orden.";
  if (d.lines.length === 0) return "Elegí al menos un material.";
  if (d.lines.some((l) => !(l.quantity > 0))) return "Las cantidades tienen que ser mayores a cero.";
  if (d.lines.some((l) => !(l.unitCost > 0))) return "Indicá el costo unitario real conseguido de cada material.";
  return null;
}

/** Próximo número correlativo (la base lo asigna igual: el máximo + 1). */
export function nextOrderNumber(orders: Pick<PurchaseOrder, "number">[]): string {
  const max = Math.max(0, ...orders.map((o) => Number(/^OC-(\d+)$/.exec(o.number)?.[1] ?? 0)));
  return `OC-${String(max + 1).padStart(4, "0")}`;
}

export interface InvoiceInput {
  invoiceNumber: string;
  invoiceAmount: number;
  invoiceDate: string;
}

export function invoiceError(order: PurchaseOrder, i: InvoiceInput): string | null {
  if (order.status !== "sent") return "Solo se factura una orden Enviada.";
  if (!i.invoiceNumber.trim()) return "Indicá el número de factura.";
  if (!(i.invoiceAmount > 0)) return "Indicá el monto de la factura.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.invoiceDate)) return "Indicá la fecha de la factura.";
  return null;
}

/**
 * Lo que crea la base al facturar (mismo id, precio y fecha): una compra real por línea. Desde acá cambia el costo
 * real de materiales del proyecto.
 */
export function invoiceEntries(order: PurchaseOrder, i: InvoiceInput, actor: string, now: string): PurchaseEntry[] {
  return order.lines.map((l) => ({
    id: orderEntryId(l),
    projectId: l.projectId,
    materialId: l.materialId,
    materialName: l.materialName,
    quantity: l.quantity,
    unit: l.unit,
    unitCost: l.unitCost,
    total: round2(l.quantity * l.unitCost),
    supplier: order.supplier,
    date: i.invoiceDate,
    notes: `${order.number} · factura ${i.invoiceNumber.trim()}`,
    createdBy: actor,
    createdAt: now,
  }));
}

/** Bitácora del proyecto por cada línea facturada (la base escribe lo mismo). */
export function invoiceMessage(order: PurchaseOrder, line: PurchaseOrderLine, invoiceNumber: string): string {
  return `Factura ${invoiceNumber.trim()} de ${order.supplier} (${order.number}): ${formatNumber(line.quantity)} ${line.unit} de ${line.materialName}.`;
}

export interface ReceiptInput {
  lineId: string;
  quantity: number;
}

/** Recibido de la orden: no / parcial / sí, según lo recibido de cada línea. */
export function receivedState(lines: Pick<PurchaseOrderLine, "quantity" | "receivedQuantity">[]): OrderReceived {
  if (lines.length > 0 && lines.every((l) => l.receivedQuantity + EPS >= l.quantity)) return "yes";
  return lines.some((l) => l.receivedQuantity > EPS) ? "partial" : "no";
}

/**
 * Recibir cantidades: el material entra al proyecto (lote con el costo real de la línea). Devuelve el cambio de stock
 * y la orden actualizada; los ids del lote y del movimiento viajan a la base para que quede igual.
 */
export function receiveOrder(
  order: PurchaseOrder,
  receipts: ReceiptInput[],
  projects: Pick<Project, "id" | "code" | "name" | "purchaseEntries">[],
  ctx: StockCtx & { today: string },
): { order: PurchaseOrder; change: StockChange; sent: Array<{ line_id: string; quantity: number; lot_id: string; movement_id: string; material_key: string }> } {
  if (order.status === "draft") throw new Error("Primero enviá la orden.");
  const change: StockChange = { lots: [], movements: [] };
  const sent: Array<{ line_id: string; quantity: number; lot_id: string; movement_id: string; material_key: string }> = [];
  const lines = order.lines.map((l) => {
    const r = receipts.find((x) => x.lineId === l.id);
    if (!r || !(r.quantity > 0)) return l;
    if (l.receivedQuantity + r.quantity > l.quantity + EPS) {
      throw new Error(`No se puede recibir más de lo pedido de ${l.materialName} (${formatNumber(l.receivedQuantity + r.quantity)} de ${formatNumber(l.quantity)}).`);
    }
    const p = projects.find((x) => x.id === l.projectId);
    const key = materialKey(l.materialId, l.materialName);
    const got = receiveStock(
      {
        materialId: key,
        materialName: l.materialName,
        unit: l.unit,
        quantity: r.quantity,
        unitCost: l.unitCost,
        supplier: order.supplier,
        date: ctx.today,
        destination: { projectId: l.projectId, projectName: p ? `${p.code} · ${p.name}` : l.projectId },
        purchaseEntryId: p?.purchaseEntries.some((e) => e.id === orderEntryId(l)) ? orderEntryId(l) : undefined,
      },
      ctx,
    );
    change.lots.push(...got.lots);
    change.movements.push(...got.movements);
    sent.push({ line_id: l.id, quantity: r.quantity, lot_id: got.lot.id, movement_id: got.movements[0].id, material_key: key });
    return { ...l, receivedQuantity: round2(l.receivedQuantity + r.quantity) };
  });
  return { order: { ...order, lines, received: receivedState(lines) }, change, sent };
}

/** Evento de bitácora para las líneas facturadas de un proyecto. */
export function invoiceActivity(order: PurchaseOrder, projectId: string, invoiceNumber: string, actor: string, now: string, id: (n: number) => string): ActivityEvent[] {
  return order.lines
    .filter((l) => l.projectId === projectId)
    .map((l, i) => ({ id: id(i), at: now, actor, kind: "purchase" as const, message: invoiceMessage(order, l, invoiceNumber) }));
}

export interface OverBudgetPurchase {
  purchaseId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  materialName: string;
  supplier?: string;
  date: string;
  quantity: number;
  unit: string;
  paidUnitCost: number;
  budgetUnitCost: number;
  /** Pagado de más en esta compra. */
  overBy: number;
  pct: number;
}

/** Cada compra que se pagó más cara que lo presupuestado para ese material en el proyecto. */
export function overBudgetPurchases(projects: Project[]): OverBudgetPurchase[] {
  return projects
    .filter((p) => !p.isClosed)
    .flatMap((p) =>
      p.purchaseEntries.flatMap((e): OverBudgetPurchase[] => {
        const key = materialKey(e.materialId, e.materialName);
        const line = p.budgetLines.find((l) => l.category === "materials" && materialKey(l.materialId, l.description) === key);
        if (!line) return [];
        const budgetUnitCost = line.quantity === null ? line.total : line.unitCost;
        if (!(budgetUnitCost > 0) || e.unitCost <= budgetUnitCost + EPS) return [];
        return [
          {
            purchaseId: e.id,
            projectId: p.id,
            projectCode: p.code,
            projectName: p.name,
            materialName: e.materialName,
            supplier: e.supplier,
            date: e.date,
            quantity: e.quantity,
            unit: e.unit,
            paidUnitCost: e.unitCost,
            budgetUnitCost,
            overBy: round2((e.unitCost - budgetUnitCost) * e.quantity),
            pct: round2(((e.unitCost - budgetUnitCost) / budgetUnitCost) * 100),
          },
        ];
      }),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.overBy - a.overBy);
}

export interface PurchasingContext {
  projects: Project[];
  orders: PurchaseOrder[];
  stock: StockState;
  settings: Pick<AlertSettings, "purchaseLeadDays" | "categoryWarningPct" | "categoryCriticalPct">;
  today: string;
}

/**
 * Alertas de Compras: material que se necesita en pocos días (Configuración → Alertas) y todavía falta pedir, y
 * compras facturadas más caras que lo estimado. Sin precio de venta ni rentabilidad.
 */
export function purchasingAlerts(ctx: PurchasingContext): Alert[] {
  const byId = new Map(ctx.projects.map((p) => [p.id, p]));
  const alerts: Alert[] = [];
  const due = toBuyWithin(materialNeeds(ctx.projects, ctx.orders, ctx.stock, ctx.today), ctx.today, ctx.settings.purchaseLeadDays);
  for (const projectId of [...new Set(due.map((l) => l.projectId))]) {
    const p = byId.get(projectId);
    if (!p) continue;
    const mine = due.filter((l) => l.projectId === projectId);
    const days = mine[0].daysLeft;
    const when = days < 0 ? `se necesitaban desde el ${formatDate(p.startDate)}` : days === 0 ? "se necesitan hoy" : `se necesitan en ${days} ${days === 1 ? "día" : "días"}`;
    const id = `${p.id}:purchase-due:${mine.map((l) => l.lineId).join(",")}`;
    alerts.push({
      ...alertBase(p),
      id,
      kind: "purchase_due",
      level: days <= 0 ? "critical" : "warning",
      title: `${mine.length} ${mine.length === 1 ? "material sin pedir" : "materiales sin pedir"}: ${when}`,
      message: `El proyecto arranca el ${formatDate(p.startDate)}. Falta pedir: ${mine.map((l) => l.description).join(", ")}.`,
      records: mine.map((l) => `${l.description} · faltan ${formatQty(l.toBuy, l.unit)} · ${NEED_STATUS_LABELS[l.status].toLowerCase()}`),
      resolutionKey: alertResolutionKey(id, p, ctx.today),
    });
  }
  for (const o of overBudgetPurchases(ctx.projects)) {
    const p = byId.get(o.projectId);
    // Una diferencia chica de precio no es una alerta: avisa desde el % de Atención (Configuración → Alertas).
    if (!p || o.pct < ctx.settings.categoryWarningPct) continue;
    const level: AlertLevel = o.pct >= ctx.settings.categoryCriticalPct ? "critical" : "warning";
    const id = `${p.id}:purchase-cost:${o.purchaseId}`;
    alerts.push({
      ...alertBase(p),
      id,
      kind: "purchase_cost",
      level,
      title: `${o.materialName}: costó ${formatNumber(o.pct, 1)} % más que lo estimado`,
      message: `Estimado ${formatCurrency(o.budgetUnitCost)} por ${o.unit || "unidad"}; costo real ${formatCurrency(o.paidUnitCost)}${o.supplier ? ` de ${o.supplier}` : ""} el ${formatDate(o.date)} (${formatQty(o.quantity, o.unit)}): ${formatCurrency(o.overBy)} más.`,
      impactAmount: o.overBy,
      records: [`Compra ${o.purchaseId} · ${formatDate(o.date)} · ${o.supplier ?? "sin proveedor"}`],
      resolutionKey: alertResolutionKey(id, p, ctx.today),
    });
  }
  return sortAlerts(alerts);
}

// ── Historial de compras y precios por proveedor ─────────────

export interface PurchaseRecord {
  id: string;
  date: string;
  key: string;
  materialName: string;
  supplier: string;
  quantity: number;
  unit: string;
  unitCost: number;
  total: number;
  /** Código del proyecto, o "Depósito" (compra para stock). */
  destination: string;
}

export const NO_SUPPLIER = "Sin proveedor";

/** Todas las compras: las de cada proyecto y las del depósito (lotes comprados para stock). */
export function purchaseHistory(projects: Project[], stock: StockState): PurchaseRecord[] {
  const fromProjects = projects.flatMap((p) =>
    p.purchaseEntries.map(
      (e): PurchaseRecord => ({
        id: e.id,
        date: e.date,
        key: materialKey(e.materialId, e.materialName),
        materialName: e.materialName,
        supplier: e.supplier?.trim() || NO_SUPPLIER,
        quantity: e.quantity,
        unit: e.unit,
        unitCost: e.unitCost,
        total: e.total,
        destination: p.code,
      }),
    ),
  );
  const fromWarehouse = stock.lots
    .filter((l) => l.kind === "purchase" && !l.purchaseEntryId)
    .flatMap((l): PurchaseRecord[] => {
      const inMove = stock.movements.find((m) => m.lotId === l.id && m.kind === "purchase_in");
      if (!inMove) return [];
      return [
        {
          id: l.id,
          date: inMove.date,
          key: l.materialId,
          materialName: l.materialName,
          supplier: l.supplier?.trim() || NO_SUPPLIER,
          quantity: inMove.quantity,
          unit: l.unit,
          unitCost: l.unitCost,
          total: round2(inMove.quantity * l.unitCost),
          destination: "Depósito",
        },
      ];
    });
  return [...fromProjects, ...fromWarehouse].sort((a, b) => b.date.localeCompare(a.date) || a.materialName.localeCompare(b.materialName));
}

export interface SupplierPrice {
  supplier: string;
  lastPrice: number;
  lastDate: string;
  minPrice: number;
  maxPrice: number;
  purchases: number;
}

export interface MaterialPrices {
  key: string;
  materialName: string;
  unit: string;
  /** Proveedores del más barato al más caro según su último precio. */
  suppliers: SupplierPrice[];
}

/** Precio de cada material por proveedor: el último pagado, el mínimo y el máximo. */
export function supplierPrices(history: PurchaseRecord[]): MaterialPrices[] {
  const byMaterial = new Map<string, PurchaseRecord[]>();
  for (const r of history) byMaterial.set(r.key, [...(byMaterial.get(r.key) ?? []), r]);
  return [...byMaterial.entries()]
    .map(([key, rs]): MaterialPrices => {
      const bySupplier = new Map<string, PurchaseRecord[]>();
      for (const r of rs) bySupplier.set(r.supplier, [...(bySupplier.get(r.supplier) ?? []), r]);
      const suppliers = [...bySupplier.entries()].map(([supplier, xs]): SupplierPrice => {
        const last = [...xs].sort((a, b) => b.date.localeCompare(a.date))[0];
        const prices = xs.map((x) => x.unitCost);
        return { supplier, lastPrice: last.unitCost, lastDate: last.date, minPrice: Math.min(...prices), maxPrice: Math.max(...prices), purchases: xs.length };
      });
      return {
        key,
        materialName: rs[0].materialName,
        unit: rs[0].unit,
        suppliers: suppliers.sort((a, b) => a.lastPrice - b.lastPrice || a.supplier.localeCompare(b.supplier)),
      };
    })
    .sort((a, b) => a.materialName.localeCompare(b.materialName));
}

// ── Cotizador de materiales (solo materiales y su costo) ─────

export interface MaterialQuoteLine extends QuoteMaterial {
  /** Cantidad a comprar con el desperdicio. */
  budgetQuantity: number;
  total: number;
}

export function materialsQuote(materials: QuoteMaterial[]): { lines: MaterialQuoteLine[]; total: number } {
  const lines = materials
    .filter((m) => m.name.trim() && m.quantity > 0)
    .map((m) => {
      const budgetQuantity = materialBudgetQuantity(m);
      return { ...m, budgetQuantity, total: round2(budgetQuantity * m.unitCost) };
    });
  return { lines, total: round2(lines.reduce((s, l) => s + l.total, 0)) };
}
