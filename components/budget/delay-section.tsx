"use client";
// "Si el trabajo se alarga": días de trabajo extra sobre lo estimado (no entregar tarde: eso es una multa aparte).
// Hipótesis a validar con el cliente: docs/CALCULO_ATRASO.md.
import { formatCurrency, formatNumber, formatPercent, formatWorkingDays } from "@/lib/formatting";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { NumField, Section } from "./fields";
import type { CalcState, CalculatorResult } from "./calculator-state";

/** "1 día" / "1,1 días" / "2,5 días": los días que soporta, con un decimal (redondeado hacia abajo). */
export function daysText(d: number): string {
  const shown = Math.floor(d * 10) / 10;
  return `${formatNumber(shown, 1)} ${shown === 1 ? "día" : "días"}`;
}

export function DelaySection({ result, state, onState }: { result: CalculatorResult; state: CalcState; onState: (patch: Partial<CalcState>) => void }) {
  const delay = result.delay;
  if (!delay) return null;
  const { input, rates, crewSize, schedule } = result;
  const floor = formatPercent(delay.floorPct);

  return (
    <Section
      title="Si el trabajo se alarga"
      help={
        <>
          <span className="block">
            Son días de trabajo extra sobre los {formatWorkingDays(schedule.workDays)} estimados (el equipo trabaja más días). No es lo mismo que entregar tarde: si
            el cliente cobra una multa por demora, cargala aparte en &quot;Multa o costo por día&quot;.
          </span>
          <span className="block">
            Costo de un día extra = operarios × jornada × tarifa de mano de obra + multa o costo por día = {crewSize} × {formatNumber(input.hoursPerDay, 1)} h ×{" "}
            {formatCurrency(rates.labor?.hourlyRate ?? 0)} + {formatCurrency(delay.dailyPenalty)}.
          </span>
          <span className="block">Costo con días extra = costo presupuestado + días × costo por día. Rentabilidad = (precio − costo) / precio.</span>
          <span className="block">
            Supuestos a confirmar con el cliente: trabaja el mismo equipo (el rubro con más operarios: {crewSize}); no se suman horas de diseño ni de
            administración; el gasto financiero no cambia con los días.
          </span>
        </>
      }
    >
      <p className="text-sm text-slate-800">
        {delay.dailyCost > 0 && delay.daysToFloor !== null ? (
          <>
            Cada día de trabajo extra cuesta <strong className="tabular">{formatCurrency(delay.dailyCost)}</strong>,{" "}
            <strong className="tabular">{formatNumber(delay.pointsPerDay, 1)} puntos de rentabilidad</strong>.{" "}
            {delay.daysToFloor < 1 ? (
              <strong>No soporta ni un día extra: ya queda por debajo del piso de {floor}.</strong>
            ) : (
              <>
                Soporta hasta <strong>{daysText(delay.daysToFloor)}</strong> extra antes de bajar de {floor}.
              </>
            )}
          </>
        ) : (
          <>Cargá operarios o una multa por día para ver cuánto cuesta cada día extra.</>
        )}
      </p>
      <p className="mt-1 text-xs text-slate-500">Blerp no conoce los costos fijos de la empresa: este cálculo no los incluye.</p>

      <div className="mt-3 grid max-w-md grid-cols-2 gap-2">
        <NumField id="d-penalty" label="Multa o costo por día" suffix="$" placeholder="Opcional" value={state.delayPenalty} onChange={(v) => onState({ delayPenalty: v })} />
        <NumField
          id="d-floor"
          label="Piso de rentabilidad"
          suffix="%"
          placeholder={formatNumber(delay.floorPct, 1)}
          value={state.delayFloorPct}
          onChange={(v) => onState({ delayFloorPct: v })}
          help="Rentabilidad mínima aceptable. Si lo dejás vacío se usa la rentabilidad total del precio sugerido."
        />
      </div>

      <div className="mt-4 overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Días de trabajo</TH>
              <TH className="text-right">Costo</TH>
              <TH className="text-right">Ganancia</TH>
              <TH className="text-right">Rentabilidad</TH>
            </TR>
          </THead>
          <TBody>
            {delay.scenarios.map((s) => (
              <TR key={s.pct}>
                <TD>{s.pct === 0 ? `Lo estimado (${formatWorkingDays(schedule.workDays)})` : `+${s.pct} % (+${formatWorkingDays(s.days)})`}</TD>
                <TD className="text-right tabular">{formatCurrency(s.cost)}</TD>
                <TD className="text-right tabular">{formatCurrency(s.profit)}</TD>
                <TD className={s.margin < delay.floorPct ? "text-right tabular text-red-700" : "text-right tabular"}>{formatPercent(s.margin)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </Section>
  );
}
