// ─────────────────────────────────────────────────────────────
// Producción (Lote 6) — funciones puras, sin importes.
// Productos del proyecto (ej. "Mesa × 10"): rubros con horas estimadas y operarios pedidos,
// unidades terminadas (las carga el Jefe de planta), estado del producto y, derivado de sus
// productos, estado y avance del proyecto; semáforo de entrega. Ver docs/PRODUCCION.md.
// ─────────────────────────────────────────────────────────────
import type { ProductRubro, ProductionStatus, Project, ProjectItem, RubroId } from "@/types";
import { daysBetween } from "./formatting";
import { rubroDef } from "./rubros";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  pending: "Pendiente",
  in_production: "En producción",
  done: "Terminado",
};

// ── Carga de un producto (Administrativo) ─────────────────────

export interface ProductInput {
  name: string;
  description?: string;
  quantity: number;
  rubros: ProductRubro[];
}

/** Problema con un producto nuevo o editado, o null si está bien. */
export function productInputError(input: ProductInput, completedUnits = 0): string | null {
  if (input.name.trim().length < 2) return "Ingresá el nombre del producto.";
  if (!Number.isInteger(input.quantity) || input.quantity < 1) return "La cantidad tiene que ser un número entero de 1 o más.";
  if (input.quantity < completedUnits) return `Ya hay ${completedUnits} unidades terminadas: la cantidad no puede ser menor.`;
  if (input.rubros.length === 0) return "Agregá al menos un rubro con sus horas estimadas.";
  const seen = new Set<RubroId>();
  for (const r of input.rubros) {
    if (seen.has(r.rubro)) return `El rubro ${rubroDef(r.rubro).label} está repetido.`;
    seen.add(r.rubro);
    if (rubroDef(r.rubro).kind !== "full") return `${rubroDef(r.rubro).label} es un importe, no lleva horas de planta.`;
    if (!(r.hours > 0)) return `Indicá las horas estimadas de ${rubroDef(r.rubro).label}.`;
    if (!Number.isInteger(r.workers) || r.workers < 1) return `Indicá cuántos operarios necesita ${rubroDef(r.rubro).label} (1 o más).`;
  }
  return null;
}

// ── Estado del producto y del proyecto ────────────────────────

/** Horas cargadas en el producto (todos los rubros y operarios). */
export function itemHours(project: Pick<Project, "actualEntries">, itemId: string): number {
  return round2(
    project.actualEntries.filter((e) => e.type === "labor" && e.itemId === itemId).reduce((s, e) => s + (e.labor?.hours ?? 0), 0),
  );
}

/**
 * Pendiente = 0 unidades terminadas y sin horas · En producción = hay horas o unidades terminadas pero no todas ·
 * Terminado = unidades terminadas = cantidad.
 */
export function productStatus(item: Pick<ProjectItem, "quantity" | "completedUnits">, hours: number): ProductionStatus {
  if (item.quantity > 0 && item.completedUnits >= item.quantity) return "done";
  if (item.completedUnits > 0 || hours > 0) return "in_production";
  return "pending";
}

/** Avance por unidades del producto (0 a 1). */
export const unitProgress = (item: Pick<ProjectItem, "quantity" | "completedUnits">): number =>
  item.quantity > 0 ? round3(Math.min(1, item.completedUnits / item.quantity)) : 0;

/** Horas estimadas del producto (suma de sus rubros). */
export const estimatedHours = (item: Pick<ProjectItem, "rubros">): number => round2(item.rubros.reduce((s, r) => s + r.hours, 0));

export interface ProductView {
  item: ProjectItem;
  status: ProductionStatus;
  progress: number;
  estimated: number;
  hours: number;
}

export interface ProjectProduction {
  /** Derivado de sus productos. Sin productos: pendiente. */
  status: ProductionStatus;
  /**
   * Avance por unidades: el de cada producto, ponderado por sus horas estimadas (una mesa pesa más que una silla).
   * Sin horas estimadas, todos los productos pesan igual.
   */
  progress: number;
  products: ProductView[];
}

export function projectProduction(project: Pick<Project, "items" | "actualEntries">): ProjectProduction {
  const products = project.items.map((item): ProductView => {
    const hours = itemHours(project, item.id);
    return { item, status: productStatus(item, hours), progress: unitProgress(item), estimated: estimatedHours(item), hours };
  });
  const status: ProductionStatus =
    products.length > 0 && products.every((p) => p.status === "done")
      ? "done"
      : products.some((p) => p.status !== "pending")
        ? "in_production"
        : "pending";
  const weight = products.reduce((s, p) => s + p.estimated, 0);
  const progress =
    products.length === 0
      ? 0
      : weight > 0
        ? round3(products.reduce((s, p) => s + p.progress * p.estimated, 0) / weight)
        : round3(products.reduce((s, p) => s + p.progress, 0) / products.length);
  return { status, progress, products };
}

// ── Semáforo de entrega ───────────────────────────────────────

export type ScheduleSignal = "on_time" | "at_risk" | "late";

export const SCHEDULE_LABELS: Record<ScheduleSignal, string> = { on_time: "En tiempo", at_risk: "En riesgo", late: "Atrasado" };

/**
 * Supuesto (a validar con el cliente) para no confiar en una fecha sola:
 * se espera que el avance acompañe al tiempo transcurrido; más de 20 puntos por detrás es "en riesgo".
 */
export const RISK_GAP = 0.2;

export interface ScheduleView {
  signal: ScheduleSignal;
  /** Días hasta la entrega (negativo = vencida). */
  daysLeft: number;
  /** Fracción del plazo transcurrida (0 a 1). */
  elapsed: number;
  progress: number;
  reason: string;
}

/**
 * Atrasado = venció la entrega y no está terminado · En riesgo = el avance va más de 20 puntos detrás del tiempo
 * transcurrido, o faltan `dueSoonDays` días o menos y no está terminado · En tiempo = el resto.
 */
export function scheduleSignal(
  project: Pick<Project, "startDate" | "dueDate" | "items" | "actualEntries">,
  today: string,
  dueSoonDays: number,
): ScheduleView {
  const { progress, status } = projectProduction(project);
  const daysLeft = daysBetween(today, project.dueDate);
  const span = Math.max(1, daysBetween(project.startDate, project.dueDate));
  const elapsed = round3(Math.min(1, Math.max(0, daysBetween(project.startDate, today) / span)));
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  if (status === "done") return { signal: "on_time", daysLeft, elapsed, progress, reason: "Producción terminada." };
  if (daysLeft < 0) return { signal: "late", daysLeft, elapsed, progress, reason: `La entrega venció hace ${-daysLeft} días con ${pct(progress)} de avance.` };
  if (progress < elapsed - RISK_GAP) {
    return { signal: "at_risk", daysLeft, elapsed, progress, reason: `Pasó el ${pct(elapsed)} del plazo y el avance es ${pct(progress)}.` };
  }
  if (daysLeft <= dueSoonDays) {
    return { signal: "at_risk", daysLeft, elapsed, progress, reason: `Faltan ${daysLeft} días para la entrega y el avance es ${pct(progress)}.` };
  }
  return { signal: "on_time", daysLeft, elapsed, progress, reason: `Avance ${pct(progress)} con el ${pct(elapsed)} del plazo transcurrido.` };
}
