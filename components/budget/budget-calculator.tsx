"use client";
// Columna principal de la cotización por rubros: rubros, plazo, resultado, aprendizaje y atraso.
// El Cotizador y el paso "Costo presupuestado" de Nuevo proyecto la usan a través de QuoteWorkspace.
import { useState } from "react";
import { Plus } from "lucide-react";
import type { RubroId } from "@/types";
import { MATERIAL_CATALOG } from "@/lib/constants";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatting";
import { RUBROS } from "@/lib/rubros";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { HelpTip } from "@/components/ui/help-tip";
import { NumField, Section } from "./fields";
import { RubroSection } from "./rubro-section";
import { LearningPanel } from "./learning-panel";
import { DelaySection } from "./delay-section";
import { newRubroRow, ratesText, type CalcState, type CalculatorResult, type RubroRow } from "./calculator-state";

export interface ProjectTypeControl {
  value: string;
  /** Sin onChange el tipo es fijo (Nuevo proyecto lo toma de "Datos del proyecto"). */
  onChange?: (type: string) => void;
}

interface Props {
  state: CalcState;
  onState: (s: CalcState) => void;
  result: CalculatorResult;
  projectType: ProjectTypeControl;
  /** Precio de venta vigente (0 si todavía no se definió). */
  salesPrice: number;
  priceError?: string;
  onSalesPrice: (n: number) => void;
}

export function BudgetCalculator({ state, onState, result, projectType, salesPrice, priceError, onSalesPrice }: Props) {
  const set = (patch: Partial<CalcState>) => onState({ ...state, ...patch });
  const setRubro = (key: string, patch: Partial<RubroRow>) => set({ rubros: state.rubros.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const available = RUBROS.filter((r) => !state.rubros.some((x) => x.rubro === r.id));
  const [toAdd, setToAdd] = useState<RubroId | "">("");
  const { suggested, atPrice, rates, input } = result;
  const manualPrice = atPrice !== null && suggested !== null && salesPrice !== suggested.price;

  return (
    <div className="space-y-4">
      <datalist id="calc-catalog">
        {MATERIAL_CATALOG.map((m) => (
          <option key={m.id} value={m.name} />
        ))}
      </datalist>

      <div className="flex items-center gap-1 text-sm font-semibold text-slate-900">
        Cotización por rubros
        <HelpTip label="Cómo se arma la cotización">
          <span className="block">
            Cada rubro tiene materiales, operarios × horas por operario, horas de diseño y horas de administración. Transporte / Fletes e Imprevistos son solo
            un importe.
          </span>
          <span className="block">Las horas se valorizan con las tarifas de Configuración: {ratesText(rates)}. La tarifa y la jornada vigentes quedan guardadas en la cotización.</span>
        </HelpTip>
      </div>

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
        title="Días de trabajo"
        help={
          <>
            <span className="block">
              Días de trabajo estimados = horas por operario / jornada del operario ({formatNumber(input.hoursPerDay, 1)} h, de Configuración), sumando los rubros
              como si se hicieran uno detrás de otro. Es un supuesto conservador, a confirmar: algunos rubros pueden hacerse en paralelo.
            </span>
            <span className="block">
              Con plazo, las horas que no entran se calculan como horas extra (tarifa × {formatNumber(input.overtimeMultiplier, 2)}). Sin plazo no hay horas extra.
            </span>
          </>
        }
      >
        <div className="max-w-[14rem]">
          <NumField id="c-deadline-days" label="Plazo (días hábiles)" placeholder="Opcional" value={state.deadlineDays} onChange={(v) => set({ deadlineDays: v })} />
        </div>
      </Section>

      <Section
        title="Resultado"
        help={
          <>
            <span className="block">Rentabilidad = ganancia sobre el precio de venta.</span>
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
            onChange={(v) => set({ materialsTargetPct: v })}
            help="Ganancia sobre el precio de venta que se busca en los materiales."
          />
          <NumField
            id="c-target-lab"
            label="Rentabilidad objetivo de mano de obra"
            suffix="%"
            value={state.laborTargetPct}
            onChange={(v) => set({ laborTargetPct: v })}
            help="Ganancia sobre el precio de venta que se busca en la mano de obra. Incluye diseño y administración (a confirmar)."
          />
          <NumField
            id="c-fin"
            label="Gasto financiero"
            suffix="%"
            value={state.financialPct}
            onChange={(v) => set({ financialPct: v })}
            help="Porcentaje sobre el precio de venta. Es un costo: aparece como línea del costo presupuestado. El valor inicial sale de Configuración."
          />
        </div>

        <div className="mt-4 space-y-3 text-sm">
          {!result.hasContent ? (
            <p className="text-slate-500">Cargá al menos un costo para ver un precio sugerido.</p>
          ) : !suggested ? (
            <p role="alert" className="text-amber-800">Los porcentajes tienen que ser menores a 100% para calcular un precio sugerido.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-blue-50 p-3">
              <div>
                <div>
                  Precio sugerido: <strong className="tabular">{formatCurrency(suggested.price)}</strong>
                </div>
                <div className="text-xs text-slate-600">
                  Rentabilidad de materiales {formatPercent(suggested.materialsMargin)} · rentabilidad de mano de obra {formatPercent(suggested.laborMargin)} · rentabilidad
                  total {formatPercent(suggested.totalMargin)}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => onSalesPrice(suggested.price)}>Usar este precio</Button>
            </div>
          )}

          <div className="flex max-w-xs flex-col gap-1">
            <label htmlFor="c-price" className="text-xs font-medium text-slate-600">Precio de venta</label>
            <Input
              id="c-price"
              inputMode="numeric"
              className="text-right"
              aria-invalid={!!priceError}
              aria-describedby={priceError ? "c-price-error" : undefined}
              value={salesPrice > 0 ? String(salesPrice) : ""}
              placeholder="0"
              onChange={(e) => onSalesPrice(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)}
            />
          </div>
          {priceError && <p id="c-price-error" role="alert" className="text-xs text-red-600">{priceError}</p>}
          {manualPrice && (
            <p>
              Con este precio la rentabilidad total es <strong className="tabular">{formatPercent(atPrice.totalMargin)}</strong>. El desglose por materiales y mano de
              obra solo aplica al precio sugerido.
            </p>
          )}
        </div>
      </Section>

      {result.hasContent && (
        <LearningPanel
          result={result}
          projectType={projectType}
          applied={state.appliedAdjustments}
          onToggle={(c) =>
            set({ appliedAdjustments: state.appliedAdjustments.includes(c) ? state.appliedAdjustments.filter((x) => x !== c) : [...state.appliedAdjustments, c] })
          }
        />
      )}

      {result.delay && <DelaySection result={result} state={state} onState={set} />}
    </div>
  );
}
