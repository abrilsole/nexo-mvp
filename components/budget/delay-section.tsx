"use client";
// "¿Qué pasa si el proyecto se alarga?" (hipótesis a validar con el cliente: docs/CALCULO_ATRASO.md).
import { formatCurrency, formatNumber, formatPercent, formatWorkingDays } from "@/lib/formatting";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DelayChart } from "@/components/charts/delay-chart";
import { NumField, Section } from "./fields";
import type { CalcState, CalculatorResult } from "./calculator-state";

export function DelaySection({ result, state, onState }: { result: CalculatorResult; state: CalcState; onState: (patch: Partial<CalcState>) => void }) {
  const delay = result.delay;
  if (!delay) return null;
  const { input, rates, crewSize } = result;
  const floor = formatPercent(delay.floorPct);
  const below = delay.scenarios[0].margin < delay.floorPct;

  return (
    <Section
      title="¿Qué pasa si el proyecto se alarga?"
      help={
        <>
          <span className="block">
            Costo de un día de atraso = operarios × jornada × tarifa de mano de obra + multa o costo por día ={" "}
            {crewSize} × {formatNumber(input.hoursPerDay, 1)} h × {formatCurrency(rates.labor?.hourlyRate ?? 0)} + {formatCurrency(delay.dailyPenalty)}.
          </span>
          <span className="block">Costo con atraso = costo presupuestado + días × costo por día. Rentabilidad = (precio de venta − costo) / precio de venta.</span>
          <span className="block">
            Supuestos a confirmar: trabaja el mismo equipo (el rubro con más operarios: {crewSize}); no se suman horas de diseño ni de administración; el gasto
            financiero no cambia con los días.
          </span>
        </>
      }
    >
      <p className="text-sm text-slate-800">
        {delay.dailyCost > 0 ? (
          <>
            Cada día de atraso cuesta <strong className="tabular">{formatCurrency(delay.dailyCost)}</strong>,{" "}
            <strong className="tabular">{formatNumber(delay.pointsPerDay, 1)} puntos de rentabilidad</strong>.{" "}
            {below ? (
              <>Ya en fecha la rentabilidad está por debajo de {floor}.</>
            ) : (
              <>
                Soporta hasta <strong>{formatWorkingDays(delay.daysToFloor ?? 0)}</strong> antes de bajar de {floor}.
              </>
            )}
          </>
        ) : (
          <>Cargá operarios o una multa por día para ver cuánto cuesta cada día de atraso.</>
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
              <TH>Atraso</TH>
              <TH className="text-right">Costo</TH>
              <TH className="text-right">Ganancia</TH>
              <TH className="text-right">Rentabilidad</TH>
            </TR>
          </THead>
          <TBody>
            {delay.scenarios.map((s) => (
              <TR key={s.days}>
                <TD>{s.days === 0 ? "En fecha" : `+${formatWorkingDays(s.days)} hábiles`}</TD>
                <TD className="text-right tabular">{formatCurrency(s.cost)}</TD>
                <TD className="text-right tabular">{formatCurrency(s.profit)}</TD>
                <TD className={s.margin < delay.floorPct ? "text-right tabular text-red-700" : "text-right tabular"}>{formatPercent(s.margin)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {delay.dailyCost > 0 && <DelayChart points={delay.points} floorPct={delay.floorPct} />}
    </Section>
  );
}
