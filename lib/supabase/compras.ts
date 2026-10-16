// ─────────────────────────────────────────────────────────────
// Compras ↔ Supabase (Lote 5C). Un usuario de Compras NO escribe las tablas directamente (no tiene
// políticas: ahí también están el precio de venta y la mano de obra). Escribe con compras_save():
// la base valida cada registro, calcula el total de la compra y completa quién lo cargó.
//
// comprasPayload() es puro: compara el estado antes y después de una acción y arma el argumento.
// Así el resto del store no cambia (igual que tallerCalls).
// ─────────────────────────────────────────────────────────────
import type { MaterialRequest, Project } from "@/types";
import type { StockState } from "@/lib/stock";
import { lotToRow, movementToRow } from "./mappers";

type Row = Record<string, unknown>;

/** Argumento `p` de compras_save. Todas las listas son opcionales. */
export interface ComprasPayload {
  purchases?: Row[];
  lots?: Row[];
  lot_locations?: Row[];
  movements?: Row[];
  activity?: Row[];
  line_statuses?: Row[];
  request_statuses?: Row[];
}

interface ComprasState {
  projects: Project[];
  stock: StockState;
  requests: MaterialRequest[];
}

function added<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const known = new Set(prev.map((x) => x.id));
  return next.filter((x) => !known.has(x.id));
}

/**
 * Lo nuevo entre `prev` y `next`: compras, lotes, movimientos, bitácora de compras/stock y pedidos del taller que se
 * resolvieron o cancelaron. null si no hay nada.
 */
export function comprasPayload(prev: ComprasState, next: ComprasState, org: string): ComprasPayload | null {
  const purchases: Row[] = [];
  const activity: Row[] = [];
  for (const p of next.projects) {
    const before = prev.projects.find((x) => x.id === p.id);
    if (!before || before === p) continue;
    for (const e of added(before.purchaseEntries, p.purchaseEntries)) {
      purchases.push({
        id: e.id,
        project_id: p.id,
        material_id: e.materialId ?? null,
        material_name: e.materialName,
        quantity: e.quantity,
        unit: e.unit,
        unit_cost: e.unitCost,
        supplier: e.supplier ?? null,
        date: e.date,
        notes: e.notes ?? null,
      });
    }
    for (const a of added(before.activity, p.activity)) {
      if (a.kind === "purchase" || a.kind === "stock") activity.push({ id: a.id, project_id: p.id, kind: a.kind, message: a.message });
    }
  }
  const lots = added(prev.stock.lots, next.stock.lots).map((l) => lotToRow(org, l));
  const movements = added(prev.stock.movements, next.stock.movements).map((m, i) => movementToRow(org, m, i));
  const request_statuses = next.requests
    .filter((q) => q.status !== "open" && prev.requests.find((x) => x.id === q.id)?.status === "open")
    .map((q) => ({ id: q.id, status: q.status }));
  if (purchases.length + lots.length + movements.length + activity.length + request_statuses.length === 0) return null;
  return { purchases, lots, movements, activity, request_statuses };
}
