// ─────────────────────────────────────────────────────────────
// Compras (Lote 5C) — funciones puras.
// Trabajan SOLO con materiales: costo presupuestado de compra, precio realmente pagado, proveedor y fechas.
// Nunca precio de venta, rentabilidad ni mano de obra (Compras no los ve: docs/ROLES_Y_PERMISOS.md).
// ─────────────────────────────────────────────────────────────
import type { Alert, AlertLevel, AlertSettings, LineStatus, Project, PurchaseLineStatus } from "@/types";
import type { StockState } from "./stock";
import { alertBase, alertResolutionKey, sortAlerts } from "./alerts";
import { materialBudgetQuantity, type QuoteMaterial } from "./budget-calculator";
import { daysBetween, formatCurrency, formatDate, formatNumber, formatQty } from "./formatting";
import { materialKey } from "./material-reconciliation";
import { addDays } from "./plant";

const EPS = 1e-6;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const LINE_STATUSES: LineStatus[] = ["pending", "quoting", "purchased", "received"];

export const LINE_STATUS_LABELS: Record<LineStatus, string> = {
  pending: "Pendiente",
  quoting: "Cotizando",
  purchased: "Comprado",
  received: "Recibido",
};

/** Lo que todavía hay que comprar (o cotizar). */
export const isOpenStatus = (s: LineStatus) => s === "pending" || s === "quoting";

export interface PurchaseLine {
  projectId: string;
  projectCode: string;
  projectName: string;
  lineId: string;
  /** Clave del material (une presupuesto, compras y stock). */
  key: string;
  materialId?: string;
  description: string;
  unit: string;
  /** null = monto directo (algo que se compra hecho: se cuenta como 1 unidad). */
  quantity: number | null;
  /** Cantidad a comprar (1 en un monto directo). */
  needed: number;
  purchased: number;
  remaining: number;
  /** Costo de compra presupuestado por unidad (en un monto directo, el monto). */
  budgetUnitCost: number;
  budgetTotal: number;
  /** Lo realmente pagado por este material en el proyecto. */
  paidTotal: number;
  /** Pagado de más contra el presupuesto por la cantidad comprada (0 si no se pasó). */
  overBy: number;
  status: LineStatus;
  /** Para cuándo se necesita: el inicio del proyecto (supuesto, ver docs/COMPRAS.md). */
  needBy: string;
  /** Días hasta needBy (negativo = ya se necesitaba). */
  daysLeft: number;
  /** Un proyecto en Cotización todavía no compra. */
  canBuy: boolean;
}

/**
 * Estado de una línea: "Recibido" lo marca Compras; si ya se compró todo es "Comprado"; si no, el que se
 * haya marcado (cotizando o comprado en parte) o "Pendiente".
 */
export function lineStatusOf(stored: LineStatus | undefined, needed: number, purchased: number): LineStatus {
  if (stored === "received") return "received";
  if (purchased + EPS >= needed) return "purchased";
  return stored ?? "pending";
}

/** Líneas de materiales de los proyectos abiertos con lo comprado, lo pagado y su estado. */
export function purchaseLines(projects: Project[], statuses: PurchaseLineStatus[], today: string): PurchaseLine[] {
  const stored = new Map(statuses.map((s) => [`${s.projectId}|${s.lineId}`, s.status]));
  return projects
    .filter((p) => !p.isClosed)
    .flatMap((p) => {
      const bought = new Map<string, { qty: number; paid: number }>();
      for (const e of p.purchaseEntries) {
        const k = materialKey(e.materialId, e.materialName);
        const b = bought.get(k) ?? { qty: 0, paid: 0 };
        bought.set(k, { qty: b.qty + e.quantity, paid: b.paid + e.total });
      }
      return p.budgetLines
        .filter((l) => l.category === "materials")
        .map((l): PurchaseLine => {
          const key = materialKey(l.materialId, l.description);
          const needed = l.quantity ?? 1;
          const budgetUnitCost = l.quantity === null ? l.total : l.unitCost;
          const b = bought.get(key) ?? { qty: 0, paid: 0 };
          const purchased = round2(b.qty);
          return {
            projectId: p.id,
            projectCode: p.code,
            projectName: p.name,
            lineId: l.id,
            key,
            materialId: l.materialId,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
            needed,
            purchased,
            remaining: round2(Math.max(0, needed - purchased)),
            budgetUnitCost,
            budgetTotal: l.total,
            paidTotal: round2(b.paid),
            overBy: round2(Math.max(0, b.paid - budgetUnitCost * purchased)),
            status: lineStatusOf(stored.get(`${p.id}|${l.id}`), needed, purchased),
            needBy: p.startDate,
            daysLeft: daysBetween(today, p.startDate),
            canBuy: p.status !== "quotation",
          };
        });
    });
}

const LESS_ADVANCED: LineStatus[] = ["pending", "quoting", "purchased", "received"];

export interface ConsolidatedLine {
  key: string;
  description: string;
  unit: string;
  needed: number;
  purchased: number;
  remaining: number;
  budgetTotal: number;
  /** El estado menos avanzado de sus líneas. */
  status: LineStatus;
  /** Cuándo lo necesita el primero que todavía no lo tiene. */
  needBy: string;
  lines: PurchaseLine[];
}

/** El mismo material de varios proyectos junto, para comprarlo una sola vez. */
export function consolidate(lines: PurchaseLine[]): ConsolidatedLine[] {
  const groups = new Map<string, PurchaseLine[]>();
  for (const l of lines) {
    const k = `${l.key}|${l.unit}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return [...groups.values()]
    .map((ls): ConsolidatedLine => {
      const pending = ls.filter((l) => l.remaining > EPS);
      return {
        key: ls[0].key,
        description: ls[0].description,
        unit: ls[0].unit,
        needed: round2(ls.reduce((s, l) => s + l.needed, 0)),
        purchased: round2(ls.reduce((s, l) => s + l.purchased, 0)),
        remaining: round2(ls.reduce((s, l) => s + l.remaining, 0)),
        budgetTotal: round2(ls.reduce((s, l) => s + l.budgetTotal, 0)),
        status: LESS_ADVANCED.find((st) => ls.some((l) => l.status === st)) ?? "pending",
        needBy: (pending.length > 0 ? pending : ls).map((l) => l.needBy).sort()[0],
        lines: [...ls].sort((a, b) => a.needBy.localeCompare(b.needBy)),
      };
    })
    .sort((a, b) => a.needBy.localeCompare(b.needBy) || a.description.localeCompare(b.description));
}

/** Pendientes de comprar: proyectos que ya compran, líneas pendientes o cotizando con algo por comprar. */
export function pendingLines(lines: PurchaseLine[]): PurchaseLine[] {
  return lines
    .filter((l) => l.canBuy && isOpenStatus(l.status) && l.remaining > EPS)
    .sort((a, b) => a.needBy.localeCompare(b.needBy) || a.projectCode.localeCompare(b.projectCode));
}

/** Qué hay que comprar en los próximos `days` días (o ya se necesitaba). */
export function toBuyWithin(lines: PurchaseLine[], today: string, days: number): PurchaseLine[] {
  const limit = addDays(today, days);
  return pendingLines(lines).filter((l) => l.needBy <= limit);
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
  statuses: PurchaseLineStatus[];
  settings: Pick<AlertSettings, "purchaseLeadDays" | "categoryCriticalPct">;
  today: string;
}

/**
 * Alertas de Compras: material que se necesita en pocos días (Configuración → Alertas) y todavía no se compró,
 * y compras pagadas más caras que lo presupuestado. Sin precio de venta ni rentabilidad.
 */
export function purchasingAlerts(ctx: PurchasingContext): Alert[] {
  const byId = new Map(ctx.projects.map((p) => [p.id, p]));
  const alerts: Alert[] = [];
  const due = toBuyWithin(purchaseLines(ctx.projects, ctx.statuses, ctx.today), ctx.today, ctx.settings.purchaseLeadDays);
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
      title: `${mine.length} ${mine.length === 1 ? "material sin comprar" : "materiales sin comprar"}: ${when}`,
      message: `El proyecto arranca el ${formatDate(p.startDate)}. Falta comprar: ${mine.map((l) => l.description).join(", ")}.`,
      records: mine.map((l) => `${l.description} · faltan ${formatQty(l.remaining, l.unit)} · ${LINE_STATUS_LABELS[l.status].toLowerCase()}`),
      resolutionKey: alertResolutionKey(id, p, ctx.today),
    });
  }
  for (const o of overBudgetPurchases(ctx.projects)) {
    const p = byId.get(o.projectId);
    if (!p) continue;
    const level: AlertLevel = o.pct >= ctx.settings.categoryCriticalPct ? "critical" : "warning";
    const id = `${p.id}:purchase-cost:${o.purchaseId}`;
    alerts.push({
      ...alertBase(p),
      id,
      kind: "purchase_cost",
      level,
      title: `${o.materialName}: se pagó ${formatNumber(o.pct, 1)} % más que lo presupuestado`,
      message: `Presupuestado ${formatCurrency(o.budgetUnitCost)} por ${o.unit || "unidad"}; se pagó ${formatCurrency(o.paidUnitCost)}${o.supplier ? ` a ${o.supplier}` : ""} el ${formatDate(o.date)} (${formatQty(o.quantity, o.unit)}): ${formatCurrency(o.overBy)} más.`,
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

// ── Registrar una compra (una o varias líneas del mismo material) ──

export interface PurchasePart {
  projectId: string;
  lineId: string;
  quantity: number;
}

export interface RecordPurchaseInput {
  materialId?: string;
  materialName: string;
  unit: string;
  supplier: string;
  /** Precio realmente pagado por unidad. */
  unitCost: number;
  date: string;
  parts: PurchasePart[];
  notes?: string;
}

export function recordPurchaseError(input: RecordPurchaseInput, today: string): string | null {
  if (!input.supplier.trim()) return "Indicá el proveedor.";
  if (!(input.unitCost > 0)) return "Indicá el precio pagado por unidad.";
  if (!input.date) return "Indicá la fecha de la compra.";
  if (input.date > today) return "La fecha de la compra no puede ser futura.";
  if (input.parts.some((p) => !(p.quantity >= 0))) return "Las cantidades no pueden ser negativas.";
  if (!input.parts.some((p) => p.quantity > 0)) return "Indicá la cantidad comprada.";
  return null;
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
