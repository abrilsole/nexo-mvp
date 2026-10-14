"use client";
import type { Project } from "@/types";
import type { ProjectEconomics } from "@/lib/calculations";
import { remainingBudgetText } from "@/lib/insights";
import { MARGIN_TOOLTIP } from "@/lib/constants";
import { formatCurrency, formatCurrencyOrDash } from "@/lib/formatting";
import { Card, CardContent } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { MarginShift } from "@/components/shared/margin-shift";

function Money({ label, value, hint, tooltip }: { label: string; value: string; hint?: string; tooltip?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {label}
        {tooltip && <HelpTip label={label}>{tooltip}</HelpTip>}
      </div>
      <div className="mt-1 text-lg font-semibold tabular text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}


export function EconomicSummary({ project, econ }: { project: Project; econ: ProjectEconomics }) {
  const completed = project.status === "completed";
  const noData = !completed && !econ.hasExecutionData;
  const remaining = remainingBudgetText(project);
  const priceText = econ.hasSalesPrice ? formatCurrency(econ.salesPrice) : "—";
  const noPriceHint = econ.hasSalesPrice ? undefined : "Sin precio de venta: no hay ganancia ni rentabilidad.";

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-600">
          {completed ? "Rentabilidad esperada vs. rentabilidad real final" : "¿Estoy ganando lo que pensé?"}
          {!completed && !noData && <HelpTip label="Rentabilidad proyectada">{MARGIN_TOOLTIP}</HelpTip>}
        </div>
        {noData ? (
          <>
            <MarginShift from={econ.expectedMargin} size="xl" />
            <p className="mt-2 text-sm text-slate-500">Sin datos todavía: la rentabilidad proyectada aparece cuando se registren consumos o costos.</p>
          </>
        ) : (
          <MarginShift from={econ.expectedMargin} to={econ.currentMargin} size="xl" toLabel={completed ? "Real final" : "Proyectada"} />
        )}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Money label="Precio de venta" value={priceText} hint={noPriceHint} />
          <Money label="Costo presupuestado" value={formatCurrency(econ.budgetTotal)} hint={`Ganancia esperada ${formatCurrencyOrDash(econ.expectedProfit)}`} />
          {completed ? (
            <Money label="Costo real final" value={formatCurrency(econ.finalActualCost ?? 0)} hint={`Ganancia real final ${formatCurrencyOrDash(econ.finalProfit)}`} />
          ) : (
            <>
              <Money
                label="Costo real hasta hoy"
                value={formatCurrency(econ.actualCostToDate)}
                tooltip="Consumido + desperdicio de materiales + costos registrados. Lo comprado NO suma hasta que se registra su consumo."
                hint={`Comprado: ${formatCurrency(econ.purchasesTotal)}`}
              />
              <Money
                label="Costo final proyectado"
                value={formatCurrency(econ.projectedFinalCost)}
                tooltip="Costo real hasta hoy + lo que falta del costo presupuestado. Por categoría: el mayor entre lo presupuestado y lo registrado."
                hint={`Ganancia proyectada ${formatCurrencyOrDash(econ.projectedProfit)}`}
              />
            </>
          )}
        </div>
        {remaining && <p className="mt-4 text-sm text-slate-600">{remaining}</p>}
      </CardContent>
    </Card>
  );
}
