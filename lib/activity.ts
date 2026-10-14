// Mensajes de actividad (quién, qué, cuándo). Compartido por el store y el seed.
import type { ActivityEvent, ActivityKind, ActualEntry, MaterialUsageEntry, PurchaseEntry } from "@/types";
import { actualEntryLabel } from "./constants";
import { formatCurrency, formatNumber, formatQty } from "./formatting";

let counter = 0;
export function createId(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  counter += 1;
  return `${prefix}_${rnd}${counter.toString(36)}`;
}

export function activity(kind: ActivityKind, actor: string, message: string, at: string, id?: string): ActivityEvent {
  return { id: id ?? createId("act"), kind, actor, message, at };
}

/**
 * Línea de tiempo de la actividad: de la más reciente a la más vieja, comparando el momento real
 * (no el texto) y sin fechas posteriores a `nowISO` (un evento futuro se muestra como ocurrido ahora).
 * Ante empates conserva el orden en que se registraron (el último cargado, primero).
 */
export function activityTimeline(events: readonly ActivityEvent[], nowISO: string): ActivityEvent[] {
  const now = new Date(nowISO).getTime();
  return events
    .map((e, i) => {
      const t = new Date(e.at).getTime();
      const safe = Number.isFinite(t) ? Math.min(t, now) : now;
      return { e: safe === t ? e : { ...e, at: new Date(safe).toISOString() }, t: safe, i };
    })
    .sort((a, b) => b.t - a.t || b.i - a.i)
    .map((x) => x.e);
}

export function usageMessage(u: MaterialUsageEntry): string {
  const parts = [`${u.createdBy} registró ${formatQty(u.quantityConsumed, u.unit)} de ${u.materialName}`];
  if (u.wasteQuantity > 0) parts.push(`${formatNumber(u.wasteQuantity)} de desperdicio`);
  if (u.reusableLeftoverQuantity > 0) parts.push(`${formatNumber(u.reusableLeftoverQuantity)} reutilizable`);
  const origin =
    u.source === "existing_stock" ? " (stock existente)" : u.source === "reused_leftover" ? " (sobrante reutilizado)" : "";
  return `${parts.join(", ")}${origin}.`;
}

export function leftoverMessage(materialName: string, quantity: number, unit: string): string {
  return `Quedaron ${formatQty(quantity, unit)} reutilizables de ${materialName} como sobrante.`;
}

export function purchaseMessage(p: PurchaseEntry): string {
  return `${p.createdBy} registró la compra de ${formatQty(p.quantity, p.unit)} de ${p.materialName}${
    p.supplier ? ` a ${p.supplier}` : ""
  } (${formatCurrency(p.total)}). No afecta el costo imputable hasta que se registre su consumo.`;
}

export function actualMessage(e: ActualEntry): string {
  if (e.type === "labor" && e.labor) {
    return `${e.createdBy} registró ${formatNumber(e.labor.hours, 1)} horas de ${e.labor.role}${
      e.labor.workerName ? ` (${e.labor.workerName})` : ""
    }.`;
  }
  return `${e.createdBy} registró ${actualEntryLabel(e).toLowerCase()}: ${e.description} (${formatCurrency(e.amount)}).`;
}
