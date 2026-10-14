"use client";
// Una sola pantalla de cotización: la usan el Cotizador y el paso "Costo presupuestado" de Nuevo proyecto.
// Solo cambian el contexto (en Nuevo proyecto ya hay datos del proyecto) y el botón final.
// El panel lateral es la única fuente del resumen: costo, precio, ganancia, rentabilidad, días y plazo.
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { formatCurrency, formatCurrencyOrDash, formatNumber, formatPercent, formatWorkingDays } from "@/lib/formatting";
import { marginPercent, profitOrNull } from "@/lib/calculations";
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
  const profit = profitOrNull(salesPrice, result.total);
  const margin = marginPercent(salesPrice - result.total, salesPrice);
  const { schedule } = result;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]" data-testid="quote-workspace">
      <BudgetCalculator
        state={state}
        onState={onState}
        result={result}
        projectType={projectType}
        salesPrice={salesPrice}
        onSalesPrice={onSalesPrice}
        priceError={priceError}
      />

      <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Resumen de la cotización">
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm">
            {context && <div className="text-xs text-slate-500">{context}</div>}
            <Row label="Costo presupuestado" value={formatCurrency(result.total)} />
            <Row label="Precio de venta" value={salesPrice > 0 ? formatCurrency(salesPrice) : "Sin definir"} />
            <Row label="Ganancia esperada" value={formatCurrencyOrDash(profit)} strong />
            <div className="border-t border-slate-100 pt-3">
              <div className="text-xs text-slate-500">Rentabilidad esperada</div>
              <div className={cn("text-3xl font-semibold tabular", margin !== null && margin < 15 ? "text-amber-700" : "text-slate-900")} aria-live="polite">
                {salesPrice > 0 ? formatPercent(margin) : "—"}
              </div>
            </div>
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <Row
                label="Días de trabajo estimados"
                value={schedule.workDays > 0 ? formatWorkingDays(schedule.workDays) : "—"}
                help="Horas por operario / jornada, sumando los rubros uno detrás de otro. Supuesto conservador, a confirmar."
              />
              <Row label="Plazo" value={schedule.availableDays !== null ? `${formatWorkingDays(schedule.availableDays)} hábiles` : "Sin plazo"} />
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

function Row({ label, value, strong, help }: { label: string; value: string; strong?: boolean; help?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-slate-500">
        {label}
        {help && <HelpTip label={label}>{help}</HelpTip>}
      </span>
      <span className={cn("tabular text-right", strong && "font-semibold text-slate-900")}>{value}</span>
    </div>
  );
}
