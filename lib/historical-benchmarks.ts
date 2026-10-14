// ─────────────────────────────────────────────────────────────
// Aprendizaje de proyectos anteriores — reglas determinísticas.
// Compara, por categoría, lo presupuestado vs. el costo real final de proyectos
// FINALIZADOS del mismo tipo. Con pocos proyectos son indicios, no conclusiones:
// siempre se informa el tamaño de la muestra.
// ─────────────────────────────────────────────────────────────
import type { BudgetCategory, Project } from "@/types";
import { actualByCategory, budgetByCategory } from "./calculations";
import { CATEGORY_LABELS, CATEGORY_ORDER, MIN_COMPARABLE_PROJECTS } from "./constants";
import { formatPercent } from "./formatting";

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

/** Mínimo de proyectos comparables para mostrar el aprendizaje (en la demo se muestra igual, rotulado). */
export const MIN_LEARNING_PROJECTS = 3;

export interface LearningInsight {
  category: BudgetCategory;
  avgOverrunPct: number;
  sampleSize: number;
  /** "En 4 proyectos parecidos, Materiales costó 10,9% más de lo presupuestado." */
  text: string;
  /** Con menos de MIN_COMPARABLE_PROJECTS es un indicio, no una conclusión. */
  weak: boolean;
}

/** Líneas de aprendizaje para Resultado: una por categoría con sobrecosto relevante. */
export function learningInsights(b: TypeBenchmarks, opts: { isDemo: boolean }): LearningInsight[] {
  return suggestedAdjustments(b)
    .filter((s) => opts.isDemo || s.sampleSize >= MIN_LEARNING_PROJECTS)
    .map((s) => ({
      category: s.category,
      avgOverrunPct: s.avgOverrunPct,
      sampleSize: s.sampleSize,
      text: `En ${s.sampleSize} ${s.sampleSize === 1 ? "proyecto parecido" : "proyectos parecidos"}, ${CATEGORY_LABELS[s.category]} costó ${formatPercent(Math.abs(s.avgOverrunPct))} ${s.avgOverrunPct >= 0 ? "más" : "menos"} de lo presupuestado.`,
      weak: s.sampleSize < MIN_COMPARABLE_PROJECTS,
    }));
}
