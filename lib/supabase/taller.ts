// ─────────────────────────────────────────────────────────────
// Taller ↔ Supabase. Un operario NO lee ni escribe las tablas directamente
// (no tiene permiso: ahí están los costos). Lee con taller_workspace() y
// escribe con las funciones taller_*: el servidor valida y calcula los costos.
//
// tallerCalls() es puro: compara el estado antes y después de una acción del
// operario y arma las llamadas. Así el resto del store no cambia.
// ─────────────────────────────────────────────────────────────
import type { MaterialRequest, Project } from "@/types";
import type { StockState } from "@/lib/stock";
import { lotToRow, movementToRow } from "./mappers";

export type TallerFunction =
  | "taller_log_hours"
  | "taller_register_usage"
  | "taller_add_stage_log"
  | "taller_add_attachment"
  | "taller_request_material";

export interface TallerCall {
  fn: TallerFunction;
  /** Argumento único `p` de la función. */
  p: Record<string, unknown>;
}

interface TallerState {
  projects: Project[];
  stock: StockState;
  requests: MaterialRequest[];
}

function added<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const known = new Set(prev.map((x) => x.id));
  return next.filter((x) => !known.has(x.id));
}

/** Movimientos y lotes nuevos que pertenecen a este proyecto (consumo, desperdicio y sobrante). */
function usageStockChange(prev: StockState, next: StockState, projectId: string, org: string) {
  const movements = added(prev.movements, next.movements).filter((m) => m.projectId === projectId);
  const lotIds = new Set(movements.filter((m) => m.kind === "leftover_in").map((m) => m.lotId));
  const lots = added(prev.lots, next.lots).filter((l) => lotIds.has(l.id));
  return {
    movements: movements.map((m, i) => movementToRow(org, m, i)),
    lots: lots.map((l) => {
      const row = lotToRow(org, l);
      return { id: row.id, parent_lot_id: row.parent_lot_id, location: row.location, dims: row.dims };
    }),
  };
}

/**
 * Llamadas a las funciones de Taller para lo que cambió entre `prev` y `next`.
 * Ningún argumento lleva costos: el servidor los toma del operario y del lote.
 */
export function tallerCalls(prev: TallerState, next: TallerState, org: string): TallerCall[] {
  const calls: TallerCall[] = [];
  for (const p of next.projects) {
    const before = prev.projects.find((x) => x.id === p.id);
    if (!before || before === p) continue;

    for (const e of added(before.actualEntries, p.actualEntries)) {
      if (e.type !== "labor" || !e.labor) continue;
      calls.push({
        fn: "taller_log_hours",
        p: {
          id: e.id,
          project_id: p.id,
          date: e.date,
          hours: e.labor.hours,
          work_type: e.labor.role,
          stage: e.stage ?? null,
          item_id: e.itemId ?? null,
          notes: e.notes ?? null,
          // Lote 5B: las horas se cargan por rubro y pueden confirmar una asignación. El tope de 24 h lo controla el servidor.
          rubro: e.rubro ?? null,
          assignment_id: e.assignmentId ?? null,
        },
      });
    }

    const usages = added(before.materialUsages, p.materialUsages);
    if (usages.length > 0) {
      const change = usageStockChange(prev.stock, next.stock, p.id, org);
      const known = new Set(before.activity.map((a) => a.id));
      calls.push({
        fn: "taller_register_usage",
        p: {
          project_id: p.id,
          date: usages[0].date,
          usages: usages.map((u) => ({
            id: u.id,
            lot_id: u.lotId ?? null,
            material_id: u.materialId,
            quantity_consumed: u.quantityConsumed,
            waste_quantity: u.wasteQuantity,
            item_id: u.itemId ?? null,
            notes: u.notes ?? null,
          })),
          movements: change.movements,
          lots: change.lots,
          activity: p.activity
            .filter((a) => !known.has(a.id) && (a.kind === "usage" || a.kind === "leftover"))
            .map((a) => ({ id: a.id, kind: a.kind, message: a.message })),
        },
      });
    }

    for (const log of added(before.stageLogs, p.stageLogs)) {
      calls.push({
        fn: "taller_add_stage_log",
        p: {
          id: log.id,
          project_id: p.id,
          stage: log.stage,
          date: log.date,
          kind: log.kind,
          text: log.text,
          responsible: log.responsible ?? null,
          item_id: log.itemId ?? null,
        },
      });
    }

    for (const a of added(before.attachments, p.attachments)) {
      calls.push({
        fn: "taller_add_attachment",
        p: {
          id: a.id,
          project_id: p.id,
          item_id: a.itemId ?? null,
          stage: a.stage ?? null,
          stage_log_id: a.stageLogId ?? null,
          name: a.name,
          mime_type: a.mimeType,
          size: a.size,
          storage_path: a.storagePath,
        },
      });
    }
  }

  for (const q of added(prev.requests, next.requests)) {
    calls.push({
      fn: "taller_request_material",
      p: {
        id: q.id,
        project_id: q.projectId,
        material_id: q.materialId,
        material_name: q.materialName,
        quantity: q.quantity,
        unit: q.unit,
        note: q.note ?? null,
      },
    });
  }
  return calls;
}
