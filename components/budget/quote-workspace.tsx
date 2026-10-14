"use client";
// Una sola pantalla de cotización: la usan el Cotizador y el paso "Costo presupuestado" de Nuevo proyecto.
// Solo cambian el contexto (en Nuevo proyecto ya hay datos del proyecto) y el botón final.
// El panel lateral es la única fuente del resumen: costo, precio, ganancia, rentabilidad, días y plazo.
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { formatCurrency, formatCurrencyOrDash, formatNumber, formatPercent, formatWorkingDays } from "@/lib/formatting";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { cn } from "@/lib/utils";
import { BudgetCalculator, type ProjectTypeControl } from "./budget-calculator";
import { quoteActionBlocker, type CalcState, type CalculatorResult } from "./calculator-state";

export interface QuoteWorkspaceProps {
  state: CalcState;
  onState: (s: CalcState) => void;
  result: CalculatorResult;
  projectType: ProjectTypeControl;
  salesPrice: number;
  onSalesPrice: (n: number) => void;
  priceError?: string;
  /** Botón final: "Crear proyecto con esta cotización" (Cotizador) o "Continuar" (Nuevo proyecto). */
  actionLabel: string;
  onAction: () => void;
  /** Línea de contexto arriba del resumen (en Nuevo proyecto: código y cliente). */
  context?: ReactNode;
}

export function QuoteWorkspace({ state, onState, result, projectType, salesPrice, onSalesPrice, priceError, actionLabel, onAction, context }: QuoteWorkspaceProps) {
  const blocker = quoteActionBlocker(result, salesPrice);
  const { schedule, breakdown: b } = result;
  const sale = (v: number | null) => (v === null ? "—" : formatCurrency(v));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]" data-testid="quote-workspace">
      <BudgetCalculator
        state={state}
        onState={onState}
        result={result}
        projectType={projectType}
        salesPrice={salesPrice}
        onSalesPrice={onSalesPrice}
        priceError={priceError}
      />

      <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto" aria-label="Resumen de la cotización">
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm">
            {context && <div className="text-xs text-slate-500">{context}</div>}
            <h2 className="flex items-center gap-1 text-sm font-semibold text-slate-900">
              Resumen <span className="font-normal text-slate-500">(importes sin IVA)</span>
              <HelpTip label="Resumen">
                Igual que la planilla de costeo: costo, rentabilidad y venta de materiales y de mano de obra; después transporte, imprevistos y gasto financiero.
                Las rentabilidades se cambian en Resultado.
              </HelpTip>
            </h2>

            <Group title="Materiales">
              <Row label="Costo" value={formatCurrency(b.materials.cost)} />
              {b.materials.safetyMargin > 0 && <Row label="incluye margen de seguridad" value={`+${formatCurrency(b.materials.safetyMargin)}`} small />}
              <Row label="Rentabilidad" value={formatPercent(b.materials.targetPct)} />
              <Row label="Venta" value={sale(b.materials.sale)} />
            </Group>

            <Group title="Mano de obra">
              <Row label="Costo" value={formatCurrency(b.labor.cost)} />
              <p className="text-xs text-slate-500 tabular">
                Operarios {formatCurrency(b.labor.operators)} · Diseño {formatCurrency(b.labor.design)} · Administración {formatCurrency(b.labor.admin)}
              </p>
              {b.labor.safetyMargin > 0 && <Row label="incluye margen de seguridad" value={`+${formatCurrency(b.labor.safetyMargin)}`} small />}
              <Row label="Rentabilidad" value={formatPercent(b.labor.targetPct)} />
              <Row label="Venta" value={sale(b.labor.sale)} />
            </Group>

            {(b.transport > 0 || b.contingency > 0 || b.financial.amount > 0) && (
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                {b.transport > 0 && <Row label="Transporte" value={formatCurrency(b.transport)} />}
                {b.contingency > 0 && <Row label="Imprevistos" value={formatCurrency(b.contingency)} />}
                <Row label={`Gasto financiero (${formatNumber(b.financial.pct, 2)} %)`} value={formatCurrency(b.financial.amount)} />
              </div>
            )}

            <div className="space-y-1.5 border-t border-slate-100 pt-3">
              <Row label="Costo total (sin IVA)" value={formatCurrency(b.totalCost)} />
              <Row
                label={b.priceSource === "suggested" ? "Precio sugerido (sin IVA)" : "Precio (sin IVA)"}
                value={b.price > 0 ? formatCurrency(b.price) : "Sin definir"}
                strong
              />
              <Row label="Ganancia" value={formatCurrencyOrDash(b.profit)} />
              <div className="flex items-baseline justify-between gap-2 pt-1">
                <span className="text-slate-500">Rentabilidad total</span>
                <span
                  className={cn("text-2xl font-semibold tabular", b.margin !== null && b.margin < 15 ? "text-amber-700" : "text-slate-900")}
                  aria-live="polite"
                >
                  {formatPercent(b.margin)}
                </span>
              </div>
              {b.priceSource === "chosen" && !b.usesSuggested && b.suggestedPrice !== null && (
                <p className="text-xs text-slate-500">Precio escrito a mano: la venta por tipo solo aplica al precio sugerido ({formatCurrency(b.suggestedPrice)}).</p>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <Row
                label="Días de trabajo estimados"
                value={schedule.workDays > 0 ? formatWorkingDays(schedule.workDays) : "—"}
                help="Horas por operario / jornada, sumando los rubros uno detrás de otro. Supuesto conservador, a confirmar."
              />
              <Row label="Plazo" value={schedule.availableDays !== null ? formatWorkingDays(schedule.availableDays) : "Sin plazo"} />
              {schedule.fits === false && (
                <p role="alert" className="flex items-start gap-1.5 text-xs text-amber-800">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  No entra en el plazo: {formatNumber(result.overtimeHours, 1)} h se calculan como horas extra.
                </p>
              )}
              {schedule.fits === true && <p className="text-xs text-emerald-700">Entra en el plazo: no hay horas extra.</p>}
            </div>
            <div className="border-t border-slate-100 pt-3">
              <Button className="w-full" onClick={onAction} disabled={blocker !== null} aria-describedby={blocker ? "quote-action-blocker" : undefined}>
                {actionLabel}
              </Button>
              {blocker && (
                <p id="quote-action-blocker" className="mt-1.5 text-xs text-slate-500">
                  {blocker}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5 border-t border-slate-100 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, strong, small, help }: { label: string; value: string; strong?: boolean; small?: boolean; help?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", small && "text-xs")}>
      <span className="flex items-center gap-1 text-slate-500">
        {label}
        {help && <HelpTip label={label}>{help}</HelpTip>}
      </span>
      <span className={cn("tabular text-right", strong && "font-semibold text-slate-900")}>{value}</span>
    </div>
  );
}
