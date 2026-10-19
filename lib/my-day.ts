// ─────────────────────────────────────────────────────────────
// "Mi día" del Operario (Lote 6) — funciones puras. Sin importes ni unidades.
// Solo lo asignado a esa persona ese día: proyecto, producto, rubro y horas estimadas de la tarea.
// El operario carga UN número (las horas) por asignación. Toda hora es contra una asignación.
// ─────────────────────────────────────────────────────────────
import type { Project, ProjectItem, WorkAssignment } from "@/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface MyDayItem {
  assignment: WorkAssignment;
  project: Project;
  /** Producto de la asignación (undefined solo en asignaciones anteriores al Lote 6). */
  item: ProjectItem | undefined;
  /** Horas ya cargadas sobre esta asignación (0 = todavía no cargó). */
  logged: number;
  done: boolean;
}

export interface MyDay {
  items: MyDayItem[];
  /** Horas del día del operario (todas sus asignaciones). */
  total: number;
}

export function myDay(projects: Project[], assignments: WorkAssignment[], operatorId: string, date: string): MyDay {
  const items = assignments
    .filter((a) => a.operatorId === operatorId && a.date === date)
    .flatMap((a): MyDayItem[] => {
      const project = projects.find((p) => p.id === a.projectId);
      if (!project) return [];
      const logged = round2(project.actualEntries.filter((e) => e.assignmentId === a.id).reduce((s, e) => s + (e.labor?.hours ?? 0), 0));
      return [{ assignment: a, project, item: project.items.find((i) => i.id === a.itemId), logged, done: logged >= a.plannedHours }];
    });
  return { items, total: round2(items.reduce((s, i) => s + i.logged, 0)) };
}
