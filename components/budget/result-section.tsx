"use client";
// Bloque "Resultado": objetivos de rentabilidad, precio sugerido, aprendizaje de proyectos anteriores
// (con margen de seguridad editable) y precio de venta. Los números salen del desglose único (quoteBreakdown).
import { totalOfLines } from "@/lib/budget-calculator";
import { CATEGORY_LABELS, MIN_COMPARABLE_PROJECTS, PROJECT_TYPES } from "@/lib/constants";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { NumField, Section } from "./fields";
import type { ProjectTypeControl } from "./budget-calculator";
import { safetyMarginFrom, type CalcState, type CalculatorResult } from "./calculator-state";

interface Props {
  state: CalcState;
  onState: (patch: Partial<CalcState>) => void;
  result: CalculatorResult;
  projectType: ProjectTypeControl;
  salesPrice: number;
  onSalesPrice: (n: number) => void;
  priceError?: string;
}

export function ResultSection({ state, onState, result, projectType, salesPrice, onSalesPrice, priceError }: Props) {
  const isDemo = useAppStore((s) => s.isDemo);
  const { breakdown: b, insights } = result;
  const pending = insights.filter((i) => !state.safetyMargins.some((m) => m.category === i.category));
  const marginAmount = (category: string) => totalOfLines(result.lines.filter((l) => !l.rubro && l.category === category));
  const setMarginPct = (category: string, pct: string) =>
    onState({ safetyMargins: state.safetyMargins.map((m) => (m.category === category ? { ...m, pct } : m)) });

  return (
    <Section
      title="Resultado"
      help={
        <>
          <span className="block">Todos los importes son sin IVA. Rentabilidad = ganancia sobre el precio de venta.</span>
          <span className="block">
            Precio sugerido = ( Materiales / (1 − rentabilidad objetivo de materiales) + Mano de obra, diseño y administración / (1 − rentabilidad objetivo de
            mano de obra) + Transporte + Imprevistos ) / (1 − gasto financiero). Transporte e imprevistos van al costo, sin rentabilidad.
          </span>
          <span className="block">Los dos objetivos separados y el gasto financiero son supuestos a confirmar con el cliente.</span>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <NumField
          id="c-target-mat"
          label="Rentabilidad objetivo de materiales"
          suffix="%"
          value={state.materialsTargetPct}
          onChange={(v) => onState({ materialsTargetPct: v })}
          help="Ganancia sobre el precio de venta que se busca en los materiales."
        />
        <NumField
          id="c-target-lab"
          label="Rentabilidad objetivo de mano de obra"
          suffix="%"
          value={state.laborTargetPct}
          onChange={(v) => onState({ laborTargetPct: v })}
          help="Ganancia sobre el precio de venta que se busca en la mano de obra. Incluye diseño y administración (a confirmar)."
        />
        <NumField
          id="c-fin"
          label="Gasto financiero"
          suffix="%"
          value={state.financialPct}
          onChange={(v) => onState({ financialPct: v })}
          help="Porcentaje sobre el precio de venta. Es un costo: aparece como línea del costo presupuestado. El valor inicial sale de Configuración."
        />
      </div>

      <div className="mt-4 space-y-3 text-sm">
        {!result.hasContent ? (
          <p className="text-slate-500">Cargá al menos un costo para ver un precio sugerido.</p>
        ) : b.suggestedPrice === null ? (
          <p role="alert" className="text-amber-800">Los porcentajes tienen que ser menores a 100% para calcular un precio sugerido.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-blue-50 p-3">
            <span>
              Precio sugerido (sin IVA): <strong className="tabular">{formatCurrency(b.suggestedPrice)}</strong>
            </span>
            <Button size="sm" variant="outline" onClick={() => b.suggestedPrice !== null && onSalesPrice(b.suggestedPrice)}>
              Usar este precio
            </Button>
          </div>
        )}

        {result.hasContent && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3" aria-label="Aprendizaje de proyectos anteriores">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Proyectos anteriores</span>
              {isDemo && <Badge>DEMO</Badge>}
              {projectType.onChange && (
                <span className="ml-auto flex items-center gap-2">
                  <label htmlFor="learn-type" className="text-xs text-slate-600">Tipo de proyecto</label>
                  <Select id="learn-type" value={projectType.value} onChange={(e) => projectType.onChange?.(e.target.value)} className="h-8 w-auto text-xs">
                    <option value="">Elegí un tipo…</option>
                    {PROJECT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                </span>
              )}
            </div>
            {!projectType.value ? (
              <p className="text-slate-500">Elegí un tipo de proyecto para compararlo con tus proyectos finalizados.</p>
            ) : pending.length === 0 && state.safetyMargins.length === 0 ? (
              <p className="text-slate-500">No hay sobrecostos relevantes en proyectos parecidos (o hay menos de 3 para comparar).</p>
            ) : null}
            {pending.map((i) => (
              <div key={i.category} className="flex flex-wrap items-center justify-between gap-2">
                <p>{i.text}</p>
                <Button size="sm" variant="outline" onClick={() => onState({ safetyMargins: [...state.safetyMargins, safetyMarginFrom(i, projectType.value)] })}>
                  Aplicar margen de seguridad
                </Button>
              </div>
            ))}
            {state.safetyMargins.map((m) => (
              <div key={m.category} className="flex flex-wrap items-end gap-2 rounded bg-amber-50 p-2">
                <div className="w-28">
                  <NumField
                    id={`sm-${m.category}`}
                    label={`Margen de seguridad ${CATEGORY_LABELS[m.category].toLowerCase()}`}
                    suffix="%"
                    value={m.pct}
                    onChange={(v) => setMarginPct(m.category, v)}
                  />
                </div>
                <span className="pb-2 tabular">= +{formatCurrency(marginAmount(m.category))}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mb-0.5"
                  onClick={() => onState({ safetyMargins: state.safetyMargins.filter((x) => x.category !== m.category) })}
                >
                  Quitar
                </Button>
                <span className="w-full text-xs text-slate-600">
                  Referencia: {m.sampleSize} proyectos parecidos costaron {formatPercent(m.referencePct)} más. Queda como línea del costo presupuestado.
                  {b.suggestedPrice !== null && ` Precio sugerido con el margen: ${formatCurrency(b.suggestedPrice)}.`}
                </span>
              </div>
            ))}
            {insights.some((i) => i.weak) && (
              <p className="text-xs text-slate-500">Con menos de {MIN_COMPARABLE_PROJECTS} proyectos comparables es un indicio, no una conclusión.</p>
            )}
          </div>
        )}

        <div className="flex max-w-xs flex-col gap-1">
          <label htmlFor="c-price" className="text-xs font-medium text-slate-600">Precio de venta (sin IVA)</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
            <Input
              id="c-price"
              inputMode="numeric"
              className="pl-6 text-right"
              aria-invalid={!!priceError}
              aria-describedby={priceError ? "c-price-error" : undefined}
              value={salesPrice > 0 ? formatNumber(salesPrice, 0) : ""}
              placeholder="0"
              onChange={(e) => onSalesPrice(Number(e.target.value.replace(/\D/g, "")) || 0)}
            />
          </div>
        </div>
        {priceError && <p id="c-price-error" role="alert" className="text-xs text-red-600">{priceError}</p>}
        {b.priceSource === "chosen" && !b.usesSuggested && b.suggestedPrice !== null && (
          <p>
            Con este precio la rentabilidad total es <strong className="tabular">{formatPercent(b.margin)}</strong>. El desglose por materiales y mano de obra solo
            aplica al precio sugerido.
          </p>
        )}
      </div>
    </Section>
  );
}
