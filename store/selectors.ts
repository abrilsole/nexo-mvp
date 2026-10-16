"use client";
// Hooks derivados: combinan estado + funciones puras. Memoizados para no recalcular en cada render.
import { useCallback, useMemo } from "react";
import type { Alert, EconomicHealth, Project } from "@/types";
import { allAlerts, openAlertCount, projectHealth, sortAlerts, splitAlerts } from "@/lib/alerts";
import { plantAlerts } from "@/lib/plant";
import { purchasingAlerts } from "@/lib/purchasing";
import type { RoleKey } from "@/lib/permissions";
import { projectEconomics, type ProjectEconomics } from "@/lib/calculations";
import { todayISO } from "@/lib/formatting";
import { isBuyer, isManager } from "@/lib/project-rules";
import { catalogPriceAt } from "@/lib/material-options";
import { effectiveIdentity, useAppStore } from "./use-app-store";

export function useToday(): string {
  return useMemo(() => todayISO(), []);
}

/** Alertas de planta (desvío de horas, sobrecarga, rubros sin asignar): sin importes. Jefe de planta y Administrativo. */
export function usePlantAlerts(): Alert[] {
  const projects = useAppStore((s) => s.projects);
  const assignments = useAppStore((s) => s.assignments);
  const operators = useAppStore((s) => s.operators);
  const settings = useAppStore((s) => s.settings);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const today = useToday();
  return useMemo(
    () => sortAlerts(plantAlerts({ projects, assignments, operators, settings, hoursPerDay, today })),
    [projects, assignments, operators, settings, hoursPerDay, today],
  );
}

/** Alertas de Compras (Lote 5C): material sin comprar a pocos días y compras más caras que lo presupuestado. */
export function usePurchasingAlerts(): Alert[] {
  const projects = useAppStore((s) => s.projects);
  const statuses = useAppStore((s) => s.lineStatuses);
  const settings = useAppStore((s) => s.settings);
  const today = useToday();
  return useMemo(() => purchasingAlerts({ projects, statuses, settings, today }), [projects, statuses, settings, today]);
}

/** Número del menú "Alertas" de cada rol (el Operario no tiene alertas). */
export function useAlertCount(role: RoleKey): number {
  const admin = useAlerts().count;
  const plant = usePlantAlerts().length;
  const buying = usePurchasingAlerts().length;
  return role === "admin" ? admin : role === "jefe_planta" ? plant : role === "compras" ? buying : 0;
}

/**
 * Alertas del Administrativo, abiertas y resueltas: las económicas, las de planta (Lote 5B) y las de compras (Lote 5C).
 * Es la única cuenta: globo, pestaña "Todas", alertas del proyecto y salud.
 */
export function useAlerts(): { open: Alert[]; resolved: Alert[]; count: number } {
  const projects = useAppStore((s) => s.projects);
  const settings = useAppStore((s) => s.settings);
  const resolvedKeys = useAppStore((s) => s.resolvedAlertIds);
  const stock = useAppStore((s) => s.stock);
  const plant = usePlantAlerts();
  const buying = usePurchasingAlerts();
  const today = useToday();
  return useMemo(() => {
    const split = splitAlerts(sortAlerts([...allAlerts(projects, settings, today, stock), ...plant, ...buying]), resolvedKeys);
    return { ...split, count: openAlertCount(split.open) };
  }, [projects, settings, resolvedKeys, today, stock, plant, buying]);
}

export function useProjectAlerts(project: Project | undefined): Alert[] {
  const { open } = useAlerts();
  return useMemo(() => (project ? open.filter((a) => a.projectId === project.id) : []), [project, open]);
}

export interface ProjectView {
  project: Project;
  econ: ProjectEconomics;
  /** null en los finalizados: no llevan chip de salud. */
  health: EconomicHealth | null;
}

export function useProjectViews(): ProjectView[] {
  const projects = useAppStore((s) => s.projects);
  const { open } = useAlerts();
  return useMemo(
    () => projects.map((project) => ({ project, econ: projectEconomics(project), health: projectHealth(project, open) })),
    [projects, open],
  );
}

export function useProjectView(id: string): ProjectView | undefined {
  const views = useProjectViews();
  return views.find((v) => v.project.id === id);
}

/** Quién opera ahora: rol, operario (si corresponde) y nombre para los registros. */
export function useIdentity() {
  const role = useAppStore((s) => s.role);
  const currentMode = useAppStore((s) => s.currentMode);
  const isDemo = useAppStore((s) => s.isDemo);
  const operators = useAppStore((s) => s.operators);
  const userId = useAppStore((s) => s.userId);
  const userEmail = useAppStore((s) => s.userEmail);
  const actingOperatorId = useAppStore((s) => s.actingOperatorId);
  const userName = useAppStore((s) => s.userName);
  return useMemo(
    () => {
      const id = effectiveIdentity({ role, currentMode, isDemo, operators, userId, userEmail, actingOperatorId, userName });
      return { ...id, isManager: isManager(id.role), isBuyer: isBuyer(id.role), realRole: role };
    },
    [role, currentMode, isDemo, operators, userId, userEmail, actingOperatorId, userName],
  );
}

/** Precio de catálogo vigente hoy de un material (precios con vigencia): lo usan las cotizaciones nuevas. */
export function useCatalogPrice(): (materialId: string) => number {
  const history = useAppStore((s) => s.priceHistory);
  return useCallback((materialId: string) => catalogPriceAt(history, materialId, todayISO()), [history]);
}
