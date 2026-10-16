// ─────────────────────────────────────────────────────────────
// Insights determinísticos (reglas explícitas, sin IA).
// Cada texto se deriva de números visibles en la UI → sin caja negra.
// ─────────────────────────────────────────────────────────────
import type { Project } from "@/types";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "./constants";
import {
  actualByCategory,
  budgetByCategory,
  materialWasteCost,
  projectEconomics,
  reusedMaterialValue,
} from "./calculations";
import { materialRows } from "./material-reconciliation";
import { projectMaterialFlow } from "./material-flow";
import type { StockState } from "./stock";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatQty,
  pluralizeUnit,
} from "./formatting";

export interface Insight {
  tone: "negative" | "positive" | "neutral";
  text: string;
}

/**
 * Lo que queda por gastar del costo presupuestado (categorías todavía por debajo de lo presupuestado).
 * Es lo que la rentabilidad proyectada asume que se va a gastar. null si no queda nada o el proyecto está finalizado.
 */
export function remainingBudgetText(project: Project): string | null {
  if (project.status === "completed") return null;
  const econ = projectEconomics(project);
  const pending = econ.categories.filter((c) => c.actual < c.budget && c.budget > 0);
  if (pending.length === 0) return null;
  const remaining = pending.reduce((s, c) => s + (c.budget - c.actual), 0);
  return `Quedan ${formatCurrency(remaining)} del costo presupuestado por gastar (${pending
    .map((c) => CATEGORY_LABELS[c.category])
    .join(", ")}). La rentabilidad proyectada asume que se van a gastar.`;
}

export function materialInsights(project: Project, stock?: StockState): Insight[] {
  const out: Insight[] = [];
  const rows = materialRows(project);
  const flow = stock ? projectMaterialFlow(stock, project.id) : null;
  for (const r of rows) {
    const line = flow?.lines.find((l) => l.key === r.key);
    const bought = line ? line.purchased.qty : r.purchasedQty;
    const extraPurchase = bought - r.budgetQty;
    const recovered = line ? line.recovered.qty + line.transferredOut.qty : r.leftoverQty;
    if (r.budgetQty > 0 && extraPurchase > 0.001 && recovered > 0) {
      out.push({
        tone: "neutral",
        text: `Compraste ${formatQty(extraPurchase, r.unit)} más de ${r.name} que lo presupuestado, pero ${formatQty(
          recovered,
          r.unit,
        )} no se usaron en este proyecto (volvieron al stock o pasaron a otro): no son costo.`,
      });
    }
    if (r.budgetQty > 0 && r.usedQty > r.budgetQty + 0.001) {
      const pct = ((r.usedQty - r.budgetQty) / r.budgetQty) * 100;
      out.push({
        tone: "negative",
        text: `Se usó ${formatPercent(pct, 0)} más ${r.name} de lo presupuestado (${formatNumber(r.usedQty)} vs ${formatNumber(
          r.budgetQty,
        )} ${pluralizeUnit(r.unit, r.budgetQty)}).`,
      });
    }
    if (r.budgetQty === 0 && r.imputedCost > 0) {
      out.push({ tone: "negative", text: `${r.name} no estaba presupuestado y ya imputa ${formatCurrency(r.imputedCost)}.` });
    }
  }
  const waste = materialWasteCost(project.materialUsages);
  if (waste > 0) out.push({ tone: "negative", text: `El desperdicio representa ${formatCurrency(waste)}.` });
  const reused = reusedMaterialValue(project.materialUsages);
  if (reused > 0) {
    out.push({ tone: "positive", text: `Este proyecto utilizó ${formatCurrency(reused)} de material reutilizado.` });
  }
  if (flow && flow.totals.held > 0 && project.status !== "completed") {
    out.push({
      tone: "neutral",
      text: `Hay ${formatCurrency(flow.totals.held)} en material asignado al proyecto que todavía no se consumió. Antes de cerrar hay que darle destino.`,
    });
  }
  return out;
}

/** Textos del cierre: “Este proyecto costó 17,4% más de lo presupuestado.” */
export function closingSummary(project: Project): { costText: string; causeText: string | null } {
  const econ = projectEconomics(project);
  const actual = econ.actualCostToDate;
  const pct = econ.budgetTotal ? ((actual - econ.budgetTotal) / econ.budgetTotal) * 100 : null;
  let costText: string;
  if (pct === null) costText = "El proyecto no tenía costo presupuestado cargado.";
  else if (Math.abs(pct) < 0.05) costText = "El costo real final fue igual al costo presupuestado.";
  else if (pct > 0) costText = `El costo real final fue ${formatPercent(pct)} mayor que el costo presupuestado.`;
  else costText = `El costo real final fue ${formatPercent(-pct)} menor que el costo presupuestado.`;

  const b = budgetByCategory(project.budgetLines);
  const a = actualByCategory(project);
  let worst: { cat: string; amount: number } | null = null;
  for (const c of CATEGORY_ORDER) {
    const d = a[c] - b[c];
    if (d > 0 && (!worst || d > worst.amount)) worst = { cat: CATEGORY_LABELS[c], amount: d };
  }
  return { costText, causeText: worst ? `Principal causa: ${worst.cat.toLowerCase()}.` : null };
}

