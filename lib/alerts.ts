// ─────────────────────────────────────────────────────────────
// Motor de alertas — derivado 100% de los datos, sin estado propio.
// Las únicas entradas son: proyecto, umbrales configurables y fecha de hoy.
// ─────────────────────────────────────────────────────────────
import type { Alert, AlertLevel, AlertSettings, EconomicHealth, Project } from "@/types";
import { projectEconomics, lastRecordDate } from "./calculations";
import { EXECUTION_STATUSES, projectSchedule } from "./project-rules";
import { projectHoldings, type StockState } from "./stock";
import { CATEGORY_IS_PLURAL, CATEGORY_LABELS, STATUS_LABELS } from "./constants";
import { daysBetween, formatCurrency, formatDays, formatMarginPoints, formatPercent, formatQty, formatSignedCurrency } from "./formatting";

export const LEVEL_RANK: Record<AlertLevel, number> = { info: 0, warning: 1, critical: 2 };

export function categoryAlertLevel(overPercent: number, s: AlertSettings): AlertLevel {
  if (overPercent > s.categoryCriticalPct) return "critical";
  if (overPercent > s.categoryWarningPct) return "warning";
  return "info";
}

/** dropPp = puntos que cayó el margen (positivo = caída). */
export function marginAlertLevel(dropPp: number, s: AlertSettings): AlertLevel {
  if (dropPp > s.marginCriticalPp) return "critical";
  if (dropPp >= s.marginWarningPp) return "warning";
  return "info";
}

/** Proyecto de una alerta (código y nombre para mostrarla). */
export function alertBase(project: Pick<Project, "id" | "code" | "name">) {
  return { projectId: project.id, projectCode: project.code, projectName: project.name };
}

/** Clave de resolución: si cambia el día o se registra algo nuevo en el proyecto, la alerta vuelve a evaluarse. */
export function alertResolutionKey(alertId: string, project: Pick<Project, "updatedAt">, today: string): string {
  return `${alertId}~${today}~${project.updatedAt}`;
}

export function projectAlerts(project: Project, settings: AlertSettings, today: string, stock?: StockState): Alert[] {
  if (project.status === "completed" || project.status === "quotation") return [];
  const econ = projectEconomics(project);
  const alerts: Omit<Alert, "resolutionKey">[] = [];

  // 1. Categorías por encima del presupuesto
  for (const row of econ.categories) {
    const over = row.actual - row.budget;
    if (over <= 0) continue;
    const label = CATEGORY_LABELS[row.category];
    const pl = CATEGORY_IS_PLURAL[row.category];
    if (row.budget === 0) {
      alerts.push({
        ...alertBase(project),
        id: `${project.id}:category:${row.category}:warning`,
        kind: "category",
        level: "warning",
        title: `${label}: costo no presupuestado`,
        message: `${label} registra ${formatSignedCurrency(over)} sin costo presupuestado.`,
        impactAmount: over,
        expectedMargin: econ.expectedMargin ?? undefined,
        projectedMargin: econ.projectedMargin ?? undefined,
      });
      continue;
    }
    const pct = (over / row.budget) * 100;
    const level = categoryAlertLevel(pct, settings);
    alerts.push({
      ...alertBase(project),
      id: `${project.id}:category:${row.category}:${level}`,
      kind: "category",
      level,
      title: `${label} ${pl ? "superaron" : "superó"} su costo presupuestado en ${formatPercent(pct, 0)}`,
      message: `${label} ${pl ? "están" : "está"} ${formatCurrency(over)} por encima de lo presupuestado.`,
      impactAmount: over,
      expectedMargin: econ.expectedMargin ?? undefined,
      projectedMargin: econ.projectedMargin ?? undefined,
    });
  }

  // 2. Caída de rentabilidad proyectado
  if (econ.marginDeltaPp !== null && econ.marginDeltaPp < -0.05) {
    const drop = -econ.marginDeltaPp;
    const level = marginAlertLevel(drop, settings);
    alerts.push({
      ...alertBase(project),
      id: `${project.id}:margin:${level}`,
      kind: "margin",
      level,
      title: `La rentabilidad proyectada cayó ${formatMarginPoints(drop)}`,
      message: `Con los costos registrados hasta hoy, la rentabilidad pasó de ${formatPercent(econ.expectedMargin)} a ${formatPercent(econ.projectedMargin)}.`,
      impactAmount: econ.costOverrun,
      expectedMargin: econ.expectedMargin ?? undefined,
      projectedMargin: econ.projectedMargin ?? undefined,
    });
  }

  // 3. Producción sin registros
  if (project.status === "production") {
    const last = lastRecordDate(project) ?? project.startDate;
    const days = daysBetween(last, today);
    if (days >= settings.daysWithoutRecords) {
      alerts.push({
        ...alertBase(project),
        id: `${project.id}:stale:${last}:warning`,
        kind: "stale",
        level: "warning",
        title: "Sin registros recientes",
        message: `Hace ${formatDays(days)} que no se registran consumos o costos en este proyecto.`,
      });
    }
  }

  // 4. Plazo + etapa (el plazo es tiempo transcurrido, no avance de obra)
  const sched = projectSchedule(project, today);
  const preProduction = project.status === "approved" || project.status === "purchasing";
  if (sched.overdue) {
    alerts.push({
      ...alertBase(project),
      id: `${project.id}:due:${project.dueDate}:critical`,
      kind: "due",
      level: "critical",
      title: "Entrega vencida",
      message: `La entrega venció hace ${formatDays(Math.abs(sched.remainingDays))} y el proyecto sigue en la etapa ${STATUS_LABELS[project.status]}.`,
    });
  } else if (preProduction && sched.remainingDays <= settings.dueSoonDays) {
    alerts.push({
      ...alertBase(project),
      id: `${project.id}:due:${project.dueDate}:warning`,
      kind: "due",
      level: "warning",
      title: `Entrega próxima y todavía en ${STATUS_LABELS[project.status]}`,
      message: `Faltan ${formatDays(sched.remainingDays)} para la entrega y el proyecto aún no pasó a la etapa Producción.`,
    });
  } else if (preProduction && sched.elapsedPct >= settings.deadlineNoProductionPct) {
    alerts.push({
      ...alertBase(project),
      id: `${project.id}:deadline:${settings.deadlineNoProductionPct}:warning`,
      kind: "due",
      level: "warning",
      title: "Mucho plazo consumido sin empezar a producir",
      message: `Pasó el ${sched.elapsedPct}% del plazo y el proyecto sigue en la etapa ${STATUS_LABELS[project.status]}.`,
    });
  }

  // 5. Proyecto en ejecución sin operarios: ningún operario lo ve ni puede cargarle horas.
  // Se resuelve sola al asignar a alguien (la alerta se deriva del equipo).
  if (EXECUTION_STATUSES.includes(project.status) && project.assignedOperatorIds.length === 0) {
    alerts.push({
      ...alertBase(project),
      id: `${project.id}:staffing:warning`,
      kind: "staffing",
      level: "warning",
      title: "Proyecto sin operario asignado",
      message: `El proyecto está en la etapa ${STATUS_LABELS[project.status]} y no tiene operarios: ningún operario lo ve ni puede cargarle horas. Asigná a alguien desde “Editar equipo”.`,
    });
  }

  // 6. Material asignado y sin consumir (sin destino). En producción es normal → info;
  // en instalación la fabricación terminó → hay que darle destino.
  if (stock && (project.status === "production" || project.status === "installation")) {
    const fabricationDone = project.status === "installation";
    const byMaterial = new Map<string, { name: string; unit: string; qty: number; value: number }>();
    for (const h of projectHoldings(stock, project.id)) {
      const cur = byMaterial.get(h.lot.materialId) ?? { name: h.lot.materialName, unit: h.lot.unit, qty: 0, value: 0 };
      cur.qty += h.quantity;
      cur.value += h.quantity * h.lot.unitCost;
      byMaterial.set(h.lot.materialId, cur);
    }
    for (const [key, m] of byMaterial) {
      const q = formatQty(m.qty, m.unit);
      alerts.push({
        ...alertBase(project),
        id: `${project.id}:reconciliation:${key}:${Math.round(m.qty * 1000)}`,
        kind: "reconciliation",
        level: fabricationDone ? "warning" : "info",
        title: `${m.name} sin consumir`,
        message: fabricationDone
          ? `Quedan ${q} asignados al proyecto sin usar. Devolvelos al stock, transferilos, marcalos como sobrante o desperdicio antes de cerrar.`
          : `Hay ${q} de ${m.name} asignados al proyecto que todavía no tienen consumo registrado.`,
        impactAmount: Math.round(m.value),
      });
    }
  }

  return sortAlerts(alerts.map((a) => ({ ...a, resolutionKey: alertResolutionKey(a.id, project, today) })));
}

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
}

export function allAlerts(projects: Project[], settings: AlertSettings, today: string, stock?: StockState): Alert[] {
  return sortAlerts(projects.flatMap((p) => projectAlerts(p, settings, today, stock)));
}

/** Separa abiertas y resueltas. Es la ÚNICA cuenta: el globo, la pestaña "Todas" y la salud salen de acá. */
export function splitAlerts(alerts: Alert[], resolvedKeys: readonly string[]): { open: Alert[]; resolved: Alert[] } {
  const set = new Set(resolvedKeys);
  return { open: alerts.filter((a) => !set.has(a.resolutionKey)), resolved: alerts.filter((a) => set.has(a.resolutionKey)) };
}

/** Número del globo de alertas = cantidad de alertas abiertas (la misma lista que la pestaña "Todas"). */
export function openAlertCount(open: readonly Alert[]): number {
  return open.length;
}

/** ¿Hay datos de ejecución? Consumos de material o costos registrados (las compras no cuentan). */
export function hasExecutionData(project: Pick<Project, "materialUsages" | "actualEntries">): boolean {
  return project.materialUsages.length > 0 || project.actualEntries.length > 0;
}

/**
 * Salud del proyecto según sus alertas ABIERTAS (la regla se explica en Configuración). Los finalizados no llevan chip: null.
 * `openAlerts` puede incluir alertas de otros proyectos; se filtran por id.
 */
export function projectHealth(project: Project, openAlerts: readonly Alert[]): EconomicHealth | null {
  if (project.status === "completed") return null;
  const own = openAlerts.filter((a) => a.projectId === project.id);
  if (own.some((a) => a.level === "critical")) return "risk";
  if (own.some((a) => a.level === "warning")) return "attention";
  if (!hasExecutionData(project)) return "no_data";
  return "healthy";
}
