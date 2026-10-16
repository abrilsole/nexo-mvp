// ─────────────────────────────────────────────────────────────
// Vista del Jefe de planta (Lote 5A) — función pura. La de Compras está en lib/purchasing.ts (Lote 5C).
// Devuelven SOLO los datos que ese rol puede ver (lib/permissions.ts): nunca precio de venta ni
// rentabilidad; a Jefe de planta, ningún importe. Con un usuario real, la base ya no los manda;
// en la demo (Administrativo mirando como otro rol) es esto lo que los deja afuera.
// ─────────────────────────────────────────────────────────────
import type { Operator, Project, ProjectStatus } from "@/types";
import { openProjectsOf } from "./operators";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PlantOperator {
  id: string;
  name: string;
  role: string;
  active: boolean;
  /** Proyectos abiertos donde está asignado (código). */
  projects: string[];
  /** Horas cargadas en total (sin valor). */
  hours: number;
}

export interface PlantProject {
  id: string;
  code: string;
  name: string;
  client: string;
  status: ProjectStatus;
  dueDate: string;
  operators: string[];
  hours: number;
}

/** Jefe de planta: operarios y proyectos con asignaciones y horas, sin ningún importe. */
export function plantView(projects: Project[], operators: Operator[]): { operators: PlantOperator[]; projects: PlantProject[] } {
  const hoursOf = (filter: (operatorId: string | undefined, projectId: string) => boolean) =>
    round2(
      projects.reduce(
        (s, p) => s + p.actualEntries.filter((e) => e.type === "labor" && filter(e.operatorId, p.id)).reduce((h, e) => h + (e.labor?.hours ?? 0), 0),
        0,
      ),
    );
  const name = (id: string) => operators.find((o) => o.id === id)?.name ?? "—";
  return {
    operators: operators.map((o) => ({
      id: o.id,
      name: o.name,
      role: o.role,
      active: o.active,
      projects: openProjectsOf(projects, o.id).map((p) => p.code),
      hours: hoursOf((op) => op === o.id),
    })),
    projects: projects
      .filter((p) => !p.isClosed)
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        client: p.client,
        status: p.status,
        dueDate: p.dueDate,
        operators: p.assignedOperatorIds.map(name),
        hours: hoursOf((_, pid) => pid === p.id),
      })),
  };
}
