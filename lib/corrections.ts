// ─────────────────────────────────────────────────────────────
// Valores congelados y correcciones auditadas (Lote 5A) — funciones puras.
// Desde Aprobado (y en un proyecto cerrado) el precio de venta y el costo presupuestado no se
// editan: se corrigen con un registro (quién, cuándo, valor anterior, nuevo y motivo).
// La corrección la hace la base (admin_correct_value); acá se valida antes y se refleja en memoria.
// ─────────────────────────────────────────────────────────────
import type { Project, ValueCorrection } from "@/types";
import { activity } from "./activity";
import { budgetLineTotal } from "./calculations";

/** Precio de venta y costo presupuestado congelados: desde Aprobado o con el proyecto cerrado. */
export function isFrozen(project: Pick<Project, "status" | "isClosed">): boolean {
  return project.isClosed || project.status !== "quotation";
}

export interface CorrectionInput {
  target: ValueCorrection["target"];
  field: ValueCorrection["field"];
  lineId?: string;
  newValue: number;
  reason: string;
}

export function correctionError(project: Project, input: CorrectionInput): string | null {
  if (!isFrozen(project)) return "Este proyecto está en Cotización: se edita directamente, sin corrección.";
  if (input.reason.trim().length < 3) return "Escribí el motivo de la corrección.";
  if (input.target === "sales_price") {
    if (input.field !== "sales_price") return "Corrección inválida.";
    return input.newValue > 0 ? null : "El precio de venta tiene que ser mayor a cero.";
  }
  if (input.field !== "quantity" && input.field !== "unit_cost") return "Corrección inválida.";
  const line = project.budgetLines.find((l) => l.id === input.lineId);
  if (!line) return "Línea del costo presupuestado no encontrada.";
  if (input.field === "quantity" && (line.quantity === null || !(input.newValue > 0))) return "Valor inválido para la corrección.";
  if (!(input.newValue >= 0)) return "Valor inválido para la corrección.";
  return null;
}

/** Lo que devuelve la base al registrar la corrección. */
export interface CorrectionReceipt {
  id: string;
  correctedAt: string;
  correctedBy: string;
  oldValue: number | null;
  description: string;
  activityId: string;
  message: string;
}

/** Aplica en memoria una corrección ya registrada en la base (mismo cambio, mismo evento de Actividad). */
export function applyCorrection(project: Project, input: CorrectionInput, receipt: CorrectionReceipt): { project: Project; correction: ValueCorrection } {
  const correction: ValueCorrection = {
    id: receipt.id,
    projectId: project.id,
    target: input.target,
    lineId: input.lineId,
    field: input.field,
    description: receipt.description,
    oldValue: receipt.oldValue,
    newValue: input.newValue,
    reason: input.reason.trim(),
    correctedBy: receipt.correctedBy,
    correctedAt: receipt.correctedAt,
  };
  const event = activity("budget", receipt.correctedBy, receipt.message, receipt.correctedAt, receipt.activityId);
  const base = { ...project, activity: [...project.activity, event] };
  if (input.target === "sales_price") return { project: { ...base, salesPrice: input.newValue, updatedAt: receipt.correctedAt }, correction };
  const budgetLines = project.budgetLines.map((l) => {
    if (l.id !== input.lineId) return l;
    const next = input.field === "quantity" ? { ...l, quantity: input.newValue } : { ...l, unitCost: input.newValue };
    return { ...next, total: budgetLineTotal(next) };
  });
  return { project: { ...base, budgetLines }, correction };
}
