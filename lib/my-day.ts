// ─────────────────────────────────────────────────────────────
// "Mi día" del Operario (Lote 5B) — funciones puras. Sin importes.
// Las asignaciones del día (proyecto, rubro y horas previstas) ya vienen precargadas:
// el operario confirma o corrige. Otros trabajos se agregan con proyecto → rubro → horas.
// ─────────────────────────────────────────────────────────────
import type { ActualEntry, Project, RubroId, WorkAssignment } from "@/types";
import { RUBROS } from "./rubros";

const round2 = (n: number) => Math.round(n * 100) / 100;
const hoursOf = (entries: ActualEntry[]) => round2(entries.reduce((s, e) => s + (e.labor?.hours ?? 0), 0));

export interface MyDayItem {
  assignment: WorkAssignment;
  project: Project;
  /** Horas ya cargadas sobre esta asignación (0 = todavía no confirmó). */
  logged: number;
  done: boolean;
}

export interface MyDay {
  items: MyDayItem[];
  /** Horas cargadas ese día que no corresponden a una asignación ("Agregar otro trabajo"). */
  extra: ActualEntry[];
  /** Todas las horas del día del operario. */
  total: number;
}

const laborOf = (p: Project, operatorId: string, date: string) =>
  p.actualEntries.filter((e) => e.type === "labor" && e.operatorId === operatorId && e.date === date);

export function myDay(projects: Project[], assignments: WorkAssignment[], operatorId: string, date: string): MyDay {
  const items = assignments
    .filter((a) => a.operatorId === operatorId && a.date === date)
    .flatMap((a): MyDayItem[] => {
      const project = projects.find((p) => p.id === a.projectId);
      if (!project) return [];
      const logged = hoursOf(project.actualEntries.filter((e) => e.assignmentId === a.id));
      return [{ assignment: a, project, logged, done: logged > 0 }];
    });
  const all = projects.flatMap((p) => laborOf(p, operatorId, date));
  return { items, extra: all.filter((e) => !e.assignmentId), total: hoursOf(all) };
}

/** Rubros donde cargar horas: los que el proyecto tiene con mano de obra; si no tiene, todos los de taller. */
export function rubroOptions(project: Pick<Project, "budgetLines">): RubroId[] {
  const own = [...new Set(project.budgetLines.filter((l) => l.category === "labor" && l.rubro).map((l) => l.rubro as RubroId))];
  return own.length > 0 ? own : RUBROS.filter((r) => r.kind === "full").map((r) => r.id);
}
