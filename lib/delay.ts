// ─────────────────────────────────────────────────────────────
// Si el trabajo se alarga — función pura (Lote 4c, escenarios proporcionales en el 4d).
// Son días de TRABAJO extra sobre lo estimado, no entregar tarde (eso sería una multa aparte, m).
// Hipótesis a validar con el cliente (docs/CALCULO_ATRASO.md):
//   c_dia = N × J × t + m      (operarios × jornada × tarifa de mano de obra + multa o costo por día)
//   C(d)  = C + d × c_dia      G(d) = P − C(d)      R(d) = G(d) / P
// El gasto financiero (% del precio) no cambia con los días. No incluye costos
// fijos de la empresa: Blerp no los conoce.
// ─────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const positive = (n: number) => Math.max(0, finite(n));

export interface DelayInput {
  /** P: precio de venta. */
  price: number;
  /** C: costo presupuestado (incluye el gasto financiero del precio). */
  cost: number;
  /** N: operarios previstos. */
  workers: number;
  /** J: jornada del operario, en horas por día (Configuración). */
  hoursPerDay: number;
  /** t: tarifa por hora de mano de obra. */
  laborRate: number;
  /** m: multa o costo por día (opcional, 0 por defecto). */
  dailyPenalty: number;
  /** r_min: piso de rentabilidad, en %. */
  floorPct: number;
  /** Días de trabajo estimados: base de los escenarios proporcionales. */
  workDays: number;
}

export interface DelayScenario {
  /** % de días de trabajo extra sobre lo estimado (0 = lo estimado). */
  pct: number;
  /** Días de trabajo extra. */
  days: number;
  cost: number;
  profit: number;
  /** Rentabilidad: ganancia sobre el precio de venta, en %. */
  margin: number;
}

export interface DelayResult {
  /** c_dia: costo de cada día de trabajo extra. */
  dailyCost: number;
  /** m usado (multa o costo por día). */
  dailyPenalty: number;
  /** Puntos de rentabilidad que se pierden por día. */
  pointsPerDay: number;
  /** Días extra que soporta antes de bajar del piso (con decimales; 0 si ya está por debajo). null si un día no cuesta nada. */
  daysToFloor: number | null;
  /** Días extra hasta ganancia cero (con decimales). null si un día no cuesta nada. */
  daysToZero: number | null;
  floorPct: number;
  /** Lo estimado y +25 %, +50 % y +100 % de los días de trabajo. */
  scenarios: DelayScenario[];
}

/** Escenarios: % de días de trabajo extra sobre lo estimado. */
const DELAY_SCENARIO_PCTS = [25, 50, 100] as const;

/** Días extra de un escenario: % de los días estimados, redondeado hacia arriba y como mínimo 1. */
export function scenarioDays(workDays: number, pct: number): number {
  return Math.max(1, Math.ceil((positive(workDays) * pct) / 100 - 1e-9));
}

/** null si no hay precio de venta o costo: no se puede calcular. */
export function delayAnalysis(input: DelayInput): DelayResult | null {
  const P = positive(input.price);
  const C = positive(input.cost);
  if (!(P > 0) || !(C > 0)) return null;
  const dailyCost = round2(positive(input.workers) * positive(input.hoursPerDay) * positive(input.laborRate) + positive(input.dailyPenalty));
  const at = (pct: number, days: number): DelayScenario => {
    const cost = round2(C + days * dailyCost);
    const profit = round2(P - cost);
    return { pct, days, cost, profit, margin: (profit / P) * 100 };
  };
  const floor = finite(input.floorPct);
  const slack = P - C - (floor / 100) * P;
  return {
    dailyCost,
    dailyPenalty: positive(input.dailyPenalty),
    pointsPerDay: (dailyCost / P) * 100,
    daysToFloor: dailyCost > 0 ? Math.max(0, slack / dailyCost) : null,
    daysToZero: dailyCost > 0 ? (P - C) / dailyCost : null,
    floorPct: floor,
    scenarios: [at(0, 0), ...DELAY_SCENARIO_PCTS.map((pct) => at(pct, scenarioDays(input.workDays, pct)))],
  };
}
