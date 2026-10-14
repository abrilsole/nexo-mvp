// Validación de los costos de Configuración (tarifas, horas extra, jornada y gasto financiero). Funciones puras.
import type { CostSettings, HourRate } from "@/types";

/** Mensaje de error, o null si los valores son válidos. */
export function costSettingsError(s: CostSettings): string | null {
  if (!(s.overtimeMultiplier >= 1 && s.overtimeMultiplier <= 5)) return "El multiplicador de horas extra tiene que estar entre 1 y 5.";
  if (!(s.financialPct >= 0 && s.financialPct < 50)) return "El gasto financiero tiene que estar entre 0% y 50%.";
  if (!(s.hoursPerDay >= 1 && s.hoursPerDay <= 24)) return "La jornada del operario tiene que estar entre 1 y 24 horas.";
  return null;
}

export function hourRatesError(rates: HourRate[]): string | null {
  const bad = rates.find((r) => !(r.hourlyRate > 0));
  return bad ? `La tarifa de ${bad.name} tiene que ser mayor a cero.` : null;
}
