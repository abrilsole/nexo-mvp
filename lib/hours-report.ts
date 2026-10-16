// ─────────────────────────────────────────────────────────────
// Horas estimadas vs reales (Lote 5B) — funciones puras para la sección "Horas" del Administrativo.
// Por operario: horas previstas en sus asignaciones (hasta hoy) vs las que cargó.
// Por rubro y por proyecto: horas estimadas en los productos (producto + rubro) vs las cargadas.
// Los importes (costo de las horas) solo los muestra el Administrativo: los demás roles nunca reciben
// `amount` ni la tarifa (la base no se los manda).
// ─────────────────────────────────────────────────────────────
import type { Operator, Project, RubroId, WorkAssignment } from "@/types";
import { rubroLabel } from "./rubros";
import { exceeds, overPct, productRubroHours, type Threshold } from "./plant";

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

const laborCostOf = (p: Project, rubro?: RubroId) =>
  p.budgetLines.filter((l) => l.category === "labor" && l.quantity !== null && (rubro === undefined || l.rubro === rubro)).reduce((s, l) => s + l.total, 0);

export interface HoursReport {
  byOperator: HoursRow[];
  byRubro: HoursRow[];
  byProject: HoursRow[];
}

export function hoursReport(input: { projects: Project[]; assignments: WorkAssignment[]; operators: Operator[]; today: string; threshold: Threshold }): HoursReport {
  const { projects, operators, threshold: t, today } = input;
  const entryCost = new Map(projects.flatMap((p) => p.actualEntries).map((e) => [e.id, e.amount]));
  const costOf = (records: { entryId: string }[]) => records.reduce((s, r) => s + (entryCost.get(r.entryId) ?? 0), 0);
  const live = projects.filter((p) => p.status !== "quotation");
  const perProject = live.map((p) => ({ p, rows: productRubroHours(p, input.assignments, t, today) }));

  const byOperator = operators
    .map((o) => {
      const work = perProject.flatMap(({ rows }) => rows.flatMap((r) => r.operators.filter((w) => w.operatorId === o.id)));
      const planned = work.reduce((s, w) => s + w.planned, 0);
      const actual = work.reduce((s, w) => s + w.actual, 0);
      const cost = costOf(perProject.flatMap(({ rows }) => rows.flatMap((r) => r.records.filter((x) => x.operatorId === o.id))));
      return row(o.id, o.name, planned, actual, t, cost, null);
    })
    .filter((r) => r.estimated > 0 || r.actual > 0);

  const rubroTotals = new Map<RubroId, { estimated: number; actual: number; cost: number }>();
  const byProject = perProject
    .map(({ p, rows }) => {
      for (const r of rows) {
        const cur = rubroTotals.get(r.rubro) ?? { estimated: 0, actual: 0, cost: 0 };
        rubroTotals.set(r.rubro, { estimated: cur.estimated + r.estimated, actual: cur.actual + r.actual, cost: cur.cost + costOf(r.records) });
      }
      const estimated = rows.reduce((s, r) => s + r.estimated, 0);
      const actual = rows.reduce((s, r) => s + r.actual, 0);
      return row(p.id, `${p.code} · ${p.name}`, estimated, actual, t, costOf(rows.flatMap((r) => r.records)), laborCostOf(p));
    })
    .filter((r) => r.estimated > 0 || r.actual > 0);

  const byRubro = [...rubroTotals.entries()].map(([rubro, v]) =>
    row(rubro, rubroLabel(rubro), v.estimated, v.actual, t, v.cost, live.reduce((s, p) => s + laborCostOf(p, rubro), 0)),
  );
  return { byOperator, byRubro, byProject };
}
