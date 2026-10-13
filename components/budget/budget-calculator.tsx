"use client";
// Calculadora de cotización por rubros. La usan el Cotizador y Nuevo proyecto (mismo componente, mismo cálculo).
import { useState } from "react";
import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";
import type { BudgetCategory, RubroId } from "@/types";
import { CATEGORY_LABELS, CATEGORY_ORDER, MATERIAL_CATALOG, MIN_COMPARABLE_PROJECTS } from "@/lib/constants";
import { averageDailyLaborCost, delayAnalysis, showDelayChart, totalOfLines } from "@/lib/budget-calculator";
import { formatCurrency, formatDate, formatNumber, formatPercent, formatWorkingDays } from "@/lib/formatting";
import { RUBROS } from "@/lib/rubros";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DelayChart } from "@/components/charts/delay-chart";
import { NumField } from "./fields";
import { RubroSection } from "./rubro-section";
import { newRubroRow, type CalcState, type CalculatorResult, type RubroRow } from "./calculator-state";

interface Props {
  state: CalcState;
  onState: (s: CalcState) => void;
  result: CalculatorResult;
  projectType: string;
  /** Precio de venta vigente del formulario (0 si todavía no se definió). */
  salesPrice: number;
  priceError?: string;
  onSalesPrice: (n: number) => void;
  /** Fecha de entrega comprometida ("" = sin fecha). */
  deadline: string;
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      {children}
    </section>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2.5 text-sm text-amber-900">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function BudgetCalculator({ state, onState, result, projectType, salesPrice, priceError, onSalesPrice, deadline }: Props) {
  const set = (patch: Partial<CalcState>) => onState({ ...state, ...patch });
  const setRubro = (key: string, patch: Partial<RubroRow>) => set({ rubros: state.rubros.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const available = RUBROS.filter((r) => !state.rubros.some((x) => x.rubro === r.id));
  const [toAdd, setToAdd] = useState<RubroId | "">("");
  const { schedule, suggested, atPrice, rates, input } = result;

  const byCat = new Map<BudgetCategory, number>();
  for (const c of CATEGORY_ORDER) {
    const v = totalOfLines(result.lines.filter((l) => l.category === c));
    if (v > 0) byCat.set(c, v);
  }
  const usesSuggestedPrice = suggested !== null && salesPrice === suggested.price;
  const overtimeHours = result.rubros.reduce((s, r) => s + (r.labor?.overtimeHours ?? 0), 0);
  const daily = averageDailyLaborCost(
    result.rubros.flatMap((r) => (r.labor ? [r.labor] : [])),
    schedule.neededDays,
  );
  const delay = delayAnalysis({ baseCost: result.total, salesPrice, dailyCost: daily, targetMarginPct: suggested?.totalMargin ?? 0 });
  const missingRate = !rates.labor?.hourlyRate || !rates.admin?.hourlyRate;

  const toggleAdjustment = (c: BudgetCategory) =>
    set({ appliedAdjustments: state.appliedAdjustments.includes(c) ? state.appliedAdjustments.filter((x) => x !== c) : [...state.appliedAdjustments, c] });

  return (
    <div className="space-y-4">
      <datalist id="calc-catalog">
        {MATERIAL_CATALOG.map((m) => (
          <option key={m.id} value={m.name} />
        ))}
      </datalist>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        La cotización se arma por rubros. Cada rubro tiene materiales, operarios × horas por operario y horas administrativas / diseño (Transporte / Fletes e
        Imprevistos son solo un importe). Las horas se valorizan con la tarifa de cada tipo de hora de{" "}
        <Link href="/settings" className="underline">Configuración</Link>: Mano de obra {formatCurrency(rates.labor?.hourlyRate ?? 0)}/h y Administrativa / diseño{" "}
        {formatCurrency(rates.admin?.hourlyRate ?? 0)}/h. La tarifa vigente queda guardada en la cotización.
      </div>
      {missingRate && <Warning>Falta la tarifa de algún tipo de hora: cargala en Configuración para que las horas sumen al costo.</Warning>}

      {state.rubros.map((row) => (
        <RubroSection
          key={row.key}
          row={row}
          result={result.rubros.find((r) => r.key === row.key)}
          onChange={(patch) => setRubro(row.key, patch)}
          onRemove={() => set({ rubros: state.rubros.filter((r) => r.key !== row.key) })}
        />
      ))}

      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="add-rubro" className="text-xs font-medium text-slate-600">Agregar rubro</label>
            <Select id="add-rubro" value={toAdd} onChange={(e) => setToAdd(e.target.value as RubroId | "")}>
              <option value="">Elegí un rubro…</option>
              {available.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={!toAdd}
            onClick={() => {
              if (!toAdd) return;
              set({ rubros: [...state.rubros, newRubroRow(toAdd)] });
              setToAdd("");
            }}
          >
            <Plus /> Agregar
          </Button>
        </div>
      )}

      <Section
        title="Días de trabajo y entrega"
        hint="Días de trabajo estimados = horas por operario / jornada, sumando los rubros como si se hicieran uno detrás de otro. Es un supuesto conservador y a confirmar: algunos rubros pueden hacerse en paralelo."
      >
        <div className="grid max-w-md grid-cols-2 gap-2">
          <NumField id="c-hpd" label="Jornada por operario" suffix="h" value={state.hoursPerDay} onChange={(v) => set({ hoursPerDay: v })} />
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-md bg-slate-50 p-2.5">
            <dt className="text-xs text-slate-500">Días de trabajo estimados</dt>
            <dd className="font-semibold tabular">{schedule.workDays > 0 ? formatWorkingDays(schedule.workDays) : "—"}</dd>
          </div>
          <div className="rounded-md bg-slate-50 p-2.5">
            <dt className="text-xs text-slate-500">Fecha de entrega comprometida</dt>
            <dd className="font-semibold tabular">
              {deadline ? `${formatDate(deadline)} · ${formatWorkingDays(schedule.availableDays ?? 0)} hábiles desde el inicio` : "Sin fecha (opcional)"}
            </dd>
          </div>
        </dl>
        {schedule.fits === false && (
          <div className="mt-3">
            <Warning>
              Los días de trabajo estimados ({formatWorkingDays(schedule.workDays)}) no entran hasta la fecha de entrega ({formatWorkingDays(schedule.availableDays ?? 0)} hábiles).
              {" "}El {formatPercent((1 - schedule.normalShare) * 100, 0)} de las horas de cada rubro se calcula como horas extra
              {overtimeHours > 0 ? ` (${formatNumber(overtimeHours, 1)} h en total)` : ""}, con la tarifa × {formatNumber(input.overtimeMultiplier, 2)}.
            </Warning>
          </div>
        )}
        {schedule.fits === true && <p className="mt-2 text-sm text-emerald-700">Los días de trabajo entran hasta la fecha de entrega: no hay horas extra.</p>}
      </Section>

      <Section
        title="Aprendizaje de proyectos anteriores"
        hint={`Compara lo presupuestado con lo que realmente costó en proyectos finalizados tipo “${projectType}”.`}
      >
        {result.benchmarks.sampleSize === 0 ? (
          <p className="text-sm text-slate-600">Todavía no hay proyectos finalizados de este tipo. Cuando cierres algunos, acá vas a ver cuánto se desviaron.</p>
        ) : result.suggestions.length === 0 ? (
          <p className="text-sm text-slate-600">
            En {result.benchmarks.sampleSize} {result.benchmarks.sampleSize === 1 ? "proyecto finalizado" : "proyectos finalizados"} de este tipo no hubo sobrecostos relevantes por categoría.
          </p>
        ) : (
          <ul className="space-y-2">
            {result.suggestions.map((s) => (
              <li key={s.category} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                <span>
                  <strong>{CATEGORY_LABELS[s.category]}</strong> cerró en promedio <strong>+{formatPercent(s.avgOverrunPct)}</strong> sobre lo presupuestado ({s.sampleSize} {s.sampleSize === 1 ? "proyecto" : "proyectos"}).
                </span>
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input type="checkbox" checked={state.appliedAdjustments.includes(s.category)} onChange={() => toggleAdjustment(s.category)} className="size-4 accent-blue-700" />
                  Sumar ese margen de seguridad
                </label>
              </li>
            ))}
          </ul>
        )}
        {result.benchmarks.sampleSize > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Es un promedio simple de proyectos finalizados, no una predicción.
            {result.benchmarks.sampleSize < MIN_COMPARABLE_PROJECTS &&
              ` Con menos de ${MIN_COMPARABLE_PROJECTS} proyectos comparables, tomalo como un indicio, no como una conclusión.`}
          </p>
        )}
      </Section>

      <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-4" aria-label="Resultado de la cotización" aria-live="polite">
        <h3 className="text-sm font-semibold text-slate-900">Resultado</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <dl className="space-y-1.5 text-sm">
            {[...byCat.entries()].map(([c, v]) => (
              <div key={c} className="flex justify-between">
                <dt className="text-slate-600">{CATEGORY_LABELS[c]}</dt>
                <dd className="tabular">{formatCurrency(v)}</dd>
              </div>
            ))}
            {!(salesPrice > 0) && input.financialPct > 0 && (
              <div className="flex justify-between text-slate-500">
                <dt>Gasto financiero</dt>
                <dd>{formatNumber(input.financialPct, 2)}% del precio (al definirlo)</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-blue-200 pt-1.5 font-semibold">
              <dt>Costo presupuestado</dt>
              <dd className="tabular">{formatCurrency(result.total)}</dd>
            </div>
          </dl>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <NumField id="c-target-mat" label="Rentab. objetivo materiales" suffix="%" value={state.materialsTargetPct} onChange={(v) => set({ materialsTargetPct: v })} />
              <NumField id="c-target-lab" label="Rentab. objetivo mano de obra" suffix="%" value={state.laborTargetPct} onChange={(v) => set({ laborTargetPct: v })} />
              <NumField id="c-fin" label="Gasto financiero" suffix="%" value={state.financialPct} onChange={(v) => set({ financialPct: v })} />
            </div>
            <p className="text-xs text-slate-500">
              Rentabilidad = ganancia sobre el precio de venta. La de mano de obra incluye las horas administrativas. Los dos objetivos separados y el gasto
              financiero ({formatNumber(input.financialPct, 2)}% del precio) son supuestos a confirmar con el cliente.
            </p>

            {suggested ? (
              <div className="space-y-2 rounded-md bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Precio sugerido: <strong className="tabular">{formatCurrency(suggested.price)}</strong>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onSalesPrice(suggested.price)}>Usar este precio</Button>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <dt className="text-slate-500">Rentab. materiales</dt>
                    <dd className="font-semibold tabular">{formatPercent(suggested.materialsMargin)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Rentab. mano de obra</dt>
                    <dd className="font-semibold tabular">{formatPercent(suggested.laborMargin)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Rentab. total</dt>
                    <dd className="font-semibold tabular">{formatPercent(suggested.totalMargin)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-slate-500 tabular">
                  ({formatCurrency(result.costs.materials)} / (1 − {formatNumber(input.materialsTargetPct, 2)}%) + {formatCurrency(result.costs.labor)} / (1 −{" "}
                  {formatNumber(input.laborTargetPct, 2)}%) + transporte {formatCurrency(result.costs.transport)} + imprevistos {formatCurrency(result.costs.contingency)}) / (1 −{" "}
                  {formatNumber(input.financialPct, 2)}% gasto financiero). Transporte e imprevistos van al costo, sin rentabilidad.
                </p>
              </div>
            ) : (
              <p className="text-slate-500">Cargá costos y objetivos menores a 100% para ver un precio sugerido.</p>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="c-price" className="text-xs font-medium text-slate-600">Precio de venta</label>
              <Input
                id="c-price"
                inputMode="numeric"
                className="text-right"
                aria-invalid={!!priceError}
                value={salesPrice > 0 ? String(salesPrice) : ""}
                placeholder="0"
                onChange={(e) => onSalesPrice(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)}
              />
            </div>
            {priceError && <p role="alert" className="text-xs text-red-600">{priceError}</p>}
            {atPrice && (
              <p>
                Con ese precio{usesSuggestedPrice ? " (el sugerido)" : ""} la <strong>rentabilidad total</strong> es{" "}
                <strong className="tabular">{formatPercent(atPrice.totalMargin)}</strong> (gasto financiero {formatCurrency(atPrice.financialCost)}).
                {!usesSuggestedPrice && " El desglose por materiales y mano de obra solo aplica al precio sugerido."}
              </p>
            )}
          </div>
        </div>

        {!showDelayChart({ salesPrice, workingDays: schedule.workDays, dailyCost: daily, cost: result.total }) ? (
          <p className="mt-5 border-t border-blue-200 pt-4 text-sm text-slate-500">
            “¿Qué pasa si el proyecto se alarga?” aparece cuando haya precio de venta y más de un día de trabajo estimado.
          </p>
        ) : (
          <div className="mt-5 border-t border-blue-200 pt-4">
            <h4 className="text-sm font-semibold text-slate-900">¿Qué pasa si el proyecto se alarga?</h4>
            <p className="mt-1 text-sm text-slate-600">
              Cada día de trabajo extra cuesta en promedio <strong className="tabular">{formatCurrency(daily)}</strong> de mano de obra
              {" "}(≈ {formatPercent((daily / salesPrice) * 100)} del precio de venta).{" "}
              {suggested &&
                (delay.belowTargetAtBase
                  ? "Con este precio ya no llegás a la rentabilidad total del precio sugerido, incluso en fecha."
                  : delay.extraDaysBeforeTarget === 0
                    ? "Desde el primer día de atraso la rentabilidad baja de la del precio sugerido."
                    : `Podés absorber ${formatWorkingDays(delay.extraDaysBeforeTarget ?? 0)} de atraso antes de bajar de la rentabilidad del precio sugerido.`)}
              {delay.extraDaysToBreakEven !== null && ` Con ${formatWorkingDays(delay.extraDaysToBreakEven + 1)} extra la ganancia llegaría a cero.`}
            </p>
            <DelayChart points={delay.points} targetMarginPct={suggested?.totalMargin ?? 0} />
            <p className="text-xs text-slate-500">
              Estimación: supone que cada día de atraso cuesta un día promedio de trabajo. La línea punteada es la rentabilidad total del precio sugerido.
            </p>
          </div>
        )}

        <p className="mt-4 text-xs text-slate-500">Al continuar, este cálculo se guarda como el costo presupuestado del proyecto, con las tarifas vigentes de hoy.</p>
      </section>
    </div>
  );
}
