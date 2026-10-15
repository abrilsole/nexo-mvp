// ─────────────────────────────────────────────────────────────
// Horas estimadas vs reales (Lote 5B) — funciones puras para la sección "Horas" del Administrativo.
// Por operario: horas previstas en las asignaciones (hasta hoy) vs las cargadas esos días.
// Por rubro y por proyecto: horas estimadas en el presupuesto vs las cargadas.
// Los importes (costo de las horas) solo los muestra el Administrativo: los demás roles nunca reciben
// `amount` ni la tarifa (la base no se los manda).
// ─────────────────────────────────────────────────────────────
import type { Operator, Project, RubroId, WorkAssignment } from "@/types";
import { rubroLabel } from "./rubros";
import { dayDeviations, exceeds, laborNeeds, overPct, rubroHours, type Threshold } from "./plant";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface HoursRow {
  key: string;
  label: string;
  estimated: number;
  actual: number;
  diff: number;
  pct: number | null;
  flagged: boolean;
  /** Costo de las horas cargadas: lo guardado en cada registro, con la tarifa vigente ese día. */
  actualCost: number;
  /** Costo estimado en el presupuesto (solo por rubro y por proyecto). */
  estimatedCost: number | null;
}

const row = (key: string, label: string, estimated: number, actual: number, t: Threshold, actualCost: number, estimatedCost: number | null): HoursRow => ({
  key,
  label,
  estimated: round2(estimated),
  actual: round2(actual),
  diff: round2(actual - estimated),
  pct: overPct(estimated, actual),
  flagged: exceeds(estimated, actual, t),
  actualCost: round2(actualCost),
  estimatedCost: estimatedCost === null ? null : round2(estimatedCost),
});

const laborCostOf = (p: Project, rubro?: RubroId | null) =>
  p.budgetLines.filter((l) => l.category === "labor" && l.quantity !== null && (rubro === undefined || l.rubro === rubro)).reduce((s, l) => s + l.total, 0);

export interface HoursReport {
  byOperator: HoursRow[];
  byRubro: HoursRow[];
  byProject: HoursRow[];
}

export function hoursReport(input: { projects: Project[]; assignments: WorkAssignment[]; operators: Operator[]; today: string; threshold: Threshold }): HoursReport {
  const { projects, operators, threshold: t } = input;
  const past = input.assignments.filter((a) => a.date <= input.today);
  const devs = dayDeviations(projects, past, t);
  const entryCost = new Map(projects.flatMap((p) => p.actualEntries).map((e) => [e.id, e.amount]));

  const byOperator = operators
    .map((o) => {
      const planned = past.filter((a) => a.operatorId === o.id).reduce((s, a) => s + a.plannedHours, 0);
      const mine = devs.filter((d) => d.operatorId === o.id);
      const actual = mine.reduce((s, d) => s + d.actual, 0);
      const cost = mine.flatMap((d) => d.records).reduce((s, r) => s + (entryCost.get(r.entryId) ?? 0), 0);
      return row(o.id, o.name, planned, actual, t, cost, null);
    })
    .filter((r) => r.estimated > 0 || r.actual > 0);

  const live = projects.filter((p) => p.status !== "quotation");
  const rubroTotals = new Map<string, { label: string; estimated: number; actual: number; cost: number; estCost: number }>();
  const byProject = live
    .map((p) => {
      const rows = rubroHours(p, t);
      for (const r of rows) {
        const key = r.rubro ?? "sin-rubro";
        const cur = rubroTotals.get(key) ?? { label: rubroLabel(r.rubro ?? undefined), estimated: 0, actual: 0, cost: 0, estCost: 0 };
        cur.estimated += r.estimated;
        cur.actual += r.actual;
        cur.cost += r.records.reduce((s, x) => s + (entryCost.get(x.entryId) ?? 0), 0);
        cur.estCost += laborCostOf(p, r.rubro);
        rubroTotals.set(key, cur);
      }
      const estimated = laborNeeds(p).reduce((s, n) => s + n.hours, 0);
      const actual = rows.reduce((s, r) => s + r.actual, 0);
      const cost = rows.flatMap((r) => r.records).reduce((s, x) => s + (entryCost.get(x.entryId) ?? 0), 0);
      return row(p.id, `${p.code} · ${p.name}`, estimated, actual, t, cost, laborCostOf(p));
    })
    .filter((r) => r.estimated > 0 || r.actual > 0);

  const byRubro = [...rubroTotals.entries()].map(([key, v]) => row(key, v.label, v.estimated, v.actual, t, v.cost, v.estCost));
  return { byOperator, byRubro, byProject };
}
