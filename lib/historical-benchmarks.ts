// ─────────────────────────────────────────────────────────────
// Aprendizaje de proyectos anteriores — reglas determinísticas.
// Compara, por categoría, lo presupuestado vs. el costo real final de proyectos
// FINALIZADOS del mismo tipo. Con pocos proyectos son indicios, no conclusiones:
// siempre se informa el tamaño de la muestra.
// ─────────────────────────────────────────────────────────────
import type { BudgetCategory, Project } from "@/types";
import { actualByCategory, budgetByCategory } from "./calculations";
import { CATEGORY_ORDER } from "./constants";

export interface CategoryBenchmark {
  category: BudgetCategory;
  /** Proyectos de la muestra que tenían presupuesto en la categoría. */
  sampleSize: number;
  /** Desvío promedio real vs. presupuesto, en %. Positivo = se pasó. */
  avgOverrunPct: number;
}

export interface TypeBenchmarks {
  projectType: string;
  /** Proyectos finalizados del tipo. */
  sampleSize: number;
  byCategory: CategoryBenchmark[];
}

export function benchmarksForType(projects: Project[], projectType: string): TypeBenchmarks {
  const finished = projects.filter((p) => p.status === "completed" && p.projectType === projectType);
  const byCategory: CategoryBenchmark[] = [];
  for (const category of CATEGORY_ORDER) {
    const pcts: number[] = [];
    for (const p of finished) {
      const budget = budgetByCategory(p.budgetLines)[category];
      if (!(budget > 0)) continue;
      const actual = actualByCategory(p)[category];
      pcts.push(((actual - budget) / budget) * 100);
    }
    if (pcts.length) {
      byCategory.push({ category, sampleSize: pcts.length, avgOverrunPct: pcts.reduce((s, n) => s + n, 0) / pcts.length });
    }
  }
  return { projectType, sampleSize: finished.length, byCategory };
}

/** Umbral mínimo de desvío promedio para sugerir un ajuste (evita ruido). */
export const MIN_SUGGESTED_OVERRUN_PCT = 3;

export function suggestedAdjustments(b: TypeBenchmarks): CategoryBenchmark[] {
  return b.byCategory.filter((c) => c.avgOverrunPct >= MIN_SUGGESTED_OVERRUN_PCT && c.category !== "contingency" && c.category !== "financial");
}
