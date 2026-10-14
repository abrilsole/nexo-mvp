// ─────────────────────────────────────────────────────────────
// Cálculos económicos de Blerp — funciones puras, sin UI ni estado.
//
// Principio central:
//   COMPRA ≠ CONSUMO ≠ DESPERDICIO ≠ SOBRANTE REUTILIZABLE
//   costo imputable de material = consumo + desperdicio (nunca la compra)
// ─────────────────────────────────────────────────────────────
import type { BudgetCategory, BudgetLine, MaterialUsageEntry, Project } from "@/types";
import { ACTIVE_STATUSES, CATEGORY_ORDER } from "./constants";

export type CategoryAmounts = Record<BudgetCategory, number>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function emptyCategoryAmounts(): CategoryAmounts {
  return CATEGORY_ORDER.reduce((acc, c) => {
    acc[c] = 0;
    return acc;
  }, {} as CategoryAmounts);
}

// ── Presupuesto ───────────────────────────────────────────────

/** quantity × unitCost, o monto directo (unitCost) si no aplica cantidad. */
export function budgetLineTotal(line: Pick<BudgetLine, "quantity" | "unitCost">): number {
  if (line.quantity === null) return round2(line.unitCost);
  return round2(line.quantity * line.unitCost);
}

export function budgetTotal(lines: BudgetLine[]): number {
  return round2(lines.reduce((s, l) => s + l.total, 0));
}

export function budgetByCategory(lines: BudgetLine[]): CategoryAmounts {
  const acc = emptyCategoryAmounts();
  for (const l of lines) acc[l.category] += l.total;
  return acc;
}

// ── Márgenes (helpers) ────────────────────────────────────────

/** ¿Hay precio de venta cargado? Sin precio no hay ganancia ni rentabilidad que mostrar. */
export function hasSalesPrice(salesPrice: number): boolean {
  return Number.isFinite(salesPrice) && salesPrice > 0;
}

/** Ganancia = precio de venta − costo. null sin precio de venta (nunca un negativo engañoso). */
export function profitOrNull(salesPrice: number, cost: number): number | null {
  return hasSalesPrice(salesPrice) ? round2(salesPrice - cost) : null;
}

/** Devuelve null cuando no hay precio de venta (evita divisiones por cero y márgenes engañosos). */
export function marginPercent(profit: number, salesPrice: number): number | null {
  if (!salesPrice || salesPrice <= 0) return null;
  return (profit / salesPrice) * 100;
}

export function expectedProfit(salesPrice: number, lines: BudgetLine[]): number {
  return salesPrice - budgetTotal(lines);
}

export function expectedMargin(salesPrice: number, lines: BudgetLine[]): number | null {
  return marginPercent(expectedProfit(salesPrice, lines), salesPrice);
}

// ── Materiales ────────────────────────────────────────────────

export function usageConsumedCost(u: Pick<MaterialUsageEntry, "quantityConsumed" | "unitCost">): number {
  return round2(u.quantityConsumed * u.unitCost);
}

export function usageWasteCost(u: Pick<MaterialUsageEntry, "wasteQuantity" | "unitCost">): number {
  return round2(u.wasteQuantity * u.unitCost);
}

/** Costo imputable al proyecto por un registro de uso: consumo + desperdicio. El sobrante NO se imputa. */
export function usageProjectCost(
  u: Pick<MaterialUsageEntry, "quantityConsumed" | "wasteQuantity" | "unitCost">,
): number {
  return round2(usageConsumedCost(u) + usageWasteCost(u));
}

export function usageLeftoverValue(u: Pick<MaterialUsageEntry, "reusableLeftoverQuantity" | "unitCost">): number {
  return round2(u.reusableLeftoverQuantity * u.unitCost);
}

/** Costo real de materiales: sale SOLO de los registros de uso, no de las compras. */
export function materialActualCost(usages: MaterialUsageEntry[]): number {
  return round2(usages.reduce((s, u) => s + usageProjectCost(u), 0));
}

export function materialWasteCost(usages: MaterialUsageEntry[]): number {
  return round2(usages.reduce((s, u) => s + usageWasteCost(u), 0));
}

export function reusedMaterialValue(usages: MaterialUsageEntry[]): number {
  return round2(
    usages.filter((u) => u.source === "reused_leftover").reduce((s, u) => s + usageProjectCost(u), 0),
  );
}

export function generatedLeftoverValue(usages: MaterialUsageEntry[]): number {
  return round2(usages.reduce((s, u) => s + usageLeftoverValue(u), 0));
}

export function purchasesTotal(project: Pick<Project, "purchaseEntries">): number {
  return round2(project.purchaseEntries.reduce((s, p) => s + p.total, 0));
}

// ── Costos reales ─────────────────────────────────────────────

export function nonMaterialActualCost(project: Pick<Project, "actualEntries">): number {
  return round2(project.actualEntries.reduce((s, e) => s + e.amount, 0));
}

export function actualCostToDate(project: Pick<Project, "actualEntries" | "materialUsages">): number {
  return round2(materialActualCost(project.materialUsages) + nonMaterialActualCost(project));
}

export function actualByCategory(project: Pick<Project, "actualEntries" | "materialUsages">): CategoryAmounts {
  const acc = emptyCategoryAmounts();
  acc.materials = materialActualCost(project.materialUsages);
  for (const e of project.actualEntries) acc[e.category] += e.amount;
  return acc;
}

// ── Desvíos ───────────────────────────────────────────────────

export interface Variance {
  amount: number;
  /** null cuando no había presupuesto para la categoría. */
  percent: number | null;
}

export function categoryVariance(actual: number, budget: number): Variance {
  const amount = round2(actual - budget);
  if (!budget) return { amount, percent: null };
  return { amount, percent: (amount / budget) * 100 };
}

/** Por categoría: si todavía gasté menos que el presupuesto, asumo que se consumirá el presupuesto; si gasté más, uso el real. */
export function projectedCategoryCost(budget: number, actual: number): number {
  return Math.max(budget, actual);
}

export interface CategoryRow {
  category: BudgetCategory;
  budget: number;
  actual: number;
  projected: number;
  /** real − presupuesto (puede ser negativo si todavía no se ejecutó). */
  actualVariance: Variance;
  /** proyectado − presupuesto (solo sobrecostos ya materializados). */
  projectedVariance: Variance;
}

/** Siempre las siete categorías de reporte, en el mismo orden (aunque estén en cero). */
export function categoryBreakdown(project: Project): CategoryRow[] {
  const b = budgetByCategory(project.budgetLines);
  const a = actualByCategory(project);
  const completed = project.status === "completed";
  return CATEGORY_ORDER.map((category) => {
    const projected = completed ? a[category] : projectedCategoryCost(b[category], a[category]);
    return {
      category,
      budget: b[category],
      actual: round2(a[category]),
      projected: round2(projected),
      actualVariance: categoryVariance(a[category], b[category]),
      projectedVariance: categoryVariance(projected, b[category]),
    };
  });
}

// ── Rentabilidad proyectada y final ─────────────────────────────────

export function projectedFinalCost(project: Pick<Project, "budgetLines" | "actualEntries" | "materialUsages">): number {
  const b = budgetByCategory(project.budgetLines);
  const a = actualByCategory(project);
  return round2(CATEGORY_ORDER.reduce((s, c) => s + projectedCategoryCost(b[c], a[c]), 0));
}

export function projectedProfit(project: Project): number {
  return project.salesPrice - projectedFinalCost(project);
}

export function projectedMargin(project: Project): number | null {
  return marginPercent(projectedProfit(project), project.salesPrice);
}

/** Rentabilidad real final: solo existe cuando el proyecto está finalizado. */
export function finalMargin(project: Project): number | null {
  if (project.status !== "completed") return null;
  return marginPercent(project.salesPrice - actualCostToDate(project), project.salesPrice);
}

export function marginDeltaPoints(expected: number | null, projected: number | null): number | null {
  if (expected === null || projected === null) return null;
  return projected - expected;
}

// ── Resumen económico del proyecto ────────────────────────────

export interface ProjectEconomics {
  salesPrice: number;
  /** false = sin precio de venta: ganancias y márgenes son null y se muestran como "—". */
  hasSalesPrice: boolean;
  /** true = todavía no hay consumos ni costos registrados. */
  hasExecutionData: boolean;
  budgetTotal: number;
  expectedProfit: number | null;
  expectedMargin: number | null;
  actualCostToDate: number;
  materialActualCost: number;
  nonMaterialActualCost: number;
  purchasesTotal: number;
  /** Para proyectos finalizados coincide con el costo real final. */
  projectedFinalCost: number;
  projectedProfit: number | null;
  projectedMargin: number | null;
  finalActualCost: number | null;
  finalProfit: number | null;
  finalMargin: number | null;
  /** Margen “vigente”: real si está cerrado, proyectado si no. */
  currentMargin: number | null;
  marginDeltaPp: number | null;
  /** "Diferencia": costo final proyectado (o real final) − costo presupuestado. */
  costOverrun: number;
  costOverrunPercent: number | null;
  categories: CategoryRow[];
  mainDeviation: CategoryRow | null;
}

export function projectEconomics(project: Project): ProjectEconomics {
  const bt = budgetTotal(project.budgetLines);
  const em = marginPercent(project.salesPrice - bt, project.salesPrice);
  const actual = actualCostToDate(project);
  const completed = project.status === "completed";
  const projected = completed ? actual : projectedFinalCost(project);
  const pm = marginPercent(project.salesPrice - projected, project.salesPrice);
  const categories = categoryBreakdown(project);
  const fm = completed ? marginPercent(project.salesPrice - actual, project.salesPrice) : null;
  // La Diferencia es la suma de los desvíos por categoría: el total de la tabla de desvío siempre cierra exacto.
  const overrun = round2(categories.reduce((s, c) => s + c.projectedVariance.amount, 0));
  return {
    salesPrice: project.salesPrice,
    hasSalesPrice: hasSalesPrice(project.salesPrice),
    hasExecutionData: project.materialUsages.length > 0 || project.actualEntries.length > 0,
    budgetTotal: bt,
    expectedProfit: profitOrNull(project.salesPrice, bt),
    expectedMargin: em,
    actualCostToDate: actual,
    materialActualCost: materialActualCost(project.materialUsages),
    nonMaterialActualCost: nonMaterialActualCost(project),
    purchasesTotal: purchasesTotal(project),
    projectedFinalCost: projected,
    projectedProfit: profitOrNull(project.salesPrice, projected),
    projectedMargin: pm,
    finalActualCost: completed ? actual : null,
    finalProfit: completed ? profitOrNull(project.salesPrice, actual) : null,
    finalMargin: fm,
    currentMargin: completed ? fm : pm,
    marginDeltaPp: marginDeltaPoints(em, completed ? fm : pm),
    costOverrun: overrun,
    costOverrunPercent: bt ? (overrun / bt) * 100 : null,
    categories,
    mainDeviation: mainDeviation(categories),
  };
}

/** Categoría con mayor sobrecosto (proyectado − presupuesto). null si ninguna está por encima. */
export function mainDeviation(rows: CategoryRow[]): CategoryRow | null {
  let best: CategoryRow | null = null;
  for (const r of rows) {
    if (r.projectedVariance.amount <= 0) continue;
    if (!best || r.projectedVariance.amount > best.projectedVariance.amount) best = r;
  }
  return best;
}

// ── Agregados (dashboard) ─────────────────────────────────────

export function isActiveProject(p: Project): boolean {
  return !p.isClosed && ACTIVE_STATUSES.includes(p.status);
}

export interface AggregateMargins {
  count: number;
  totalSales: number;
  totalBudget: number;
  totalProjectedCost: number;
  expectedAggregateMargin: number | null;
  projectedAggregateMargin: number | null;
}

/** Margen agregado ponderado por venta (NO promedio simple de márgenes). */
export function aggregateMargins(projects: Project[]): AggregateMargins {
  let totalSales = 0;
  let totalBudget = 0;
  let totalProjectedCost = 0;
  for (const p of projects) {
    totalSales += p.salesPrice;
    totalBudget += budgetTotal(p.budgetLines);
    totalProjectedCost += projectedFinalCost(p);
  }
  return {
    count: projects.length,
    totalSales,
    totalBudget,
    totalProjectedCost,
    expectedAggregateMargin: marginPercent(totalSales - totalBudget, totalSales),
    projectedAggregateMargin: marginPercent(totalSales - totalProjectedCost, totalSales),
  };
}

// ── Actividad / registros ─────────────────────────────────────

/** Fecha del último registro real (consumo o costo). Las compras no cuentan como registro de ejecución. */
export function lastRecordDate(project: Pick<Project, "actualEntries" | "materialUsages">): string | null {
  const dates = [...project.actualEntries.map((e) => e.date), ...project.materialUsages.map((u) => u.date)];
  if (dates.length === 0) return null;
  return dates.sort().at(-1) ?? null;
}
