// ─────────────────────────────────────────────────────────────
// ¿Qué pasa si el proyecto se alarga? — función pura (Lote 4c).
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
  /** m: multa o costo por día de atraso (opcional, 0 por defecto). */
  dailyPenalty: number;
  /** r_min: piso de rentabilidad, en %. */
  floorPct: number;
}

export interface DelayScenario {
  /** Días hábiles de atraso. */
  days: number;
  cost: number;
  profit: number;
  /** Rentabilidad: ganancia sobre el precio de venta, en %. */
  margin: number;
}

export interface DelayResult {
  /** c_dia: costo de cada día de atraso. */
  dailyCost: number;
  /** m usado (multa o costo por día). */
  dailyPenalty: number;
  /** Puntos de rentabilidad que se pierden por día. */
  pointsPerDay: number;
  /** Días que soporta antes de bajar del piso (0 si ya está por debajo). null si un día no cuesta nada. */
  daysToFloor: number | null;
  /** Días hasta ganancia cero (sin redondear). null si un día no cuesta nada. */
  daysToZero: number | null;
  floorPct: number;
  scenarios: DelayScenario[];
  /** Un punto por día (0..maxDays) para el gráfico. */
  points: DelayScenario[];
}

const DELAY_SCENARIO_DAYS = [0, 3, 5, 10, 15] as const;

/** null si no hay precio de venta o costo: no se puede calcular. */
export function delayAnalysis(input: DelayInput, maxDays = 15): DelayResult | null {
  const P = positive(input.price);
  const C = positive(input.cost);
  if (!(P > 0) || !(C > 0)) return null;
  const dailyCost = round2(positive(input.workers) * positive(input.hoursPerDay) * positive(input.laborRate) + positive(input.dailyPenalty));
  const at = (days: number): DelayScenario => {
    const cost = round2(C + days * dailyCost);
    const profit = round2(P - cost);
    return { days, cost, profit, margin: (profit / P) * 100 };
  };
  const floor = finite(input.floorPct);
  const slack = P - C - (floor / 100) * P;
  return {
    dailyCost,
    dailyPenalty: positive(input.dailyPenalty),
    pointsPerDay: (dailyCost / P) * 100,
    daysToFloor: dailyCost > 0 ? Math.max(0, Math.floor(slack / dailyCost + 1e-9)) : null,
    daysToZero: dailyCost > 0 ? (P - C) / dailyCost : null,
    floorPct: floor,
    scenarios: DELAY_SCENARIO_DAYS.map(at),
    points: Array.from({ length: maxDays + 1 }, (_, d) => at(d)),
  };
}
