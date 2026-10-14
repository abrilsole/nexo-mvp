"use client";
// Paso "Revisar y crear" de Nuevo proyecto: todo sale del mismo resultado de la calculadora (sin recalcular
// ni duplicar números). De arriba hacia abajo: encabezado, resultado, tabla por rubro, supuestos y avisos.
import { TriangleAlert } from "lucide-react";
import { rubroTable, type RubroTableRow } from "@/lib/budget-calculator";
import { marginPercent, profitOrNull } from "@/lib/calculations";
import { formatCurrency, formatCurrencyOrDash, formatDate, formatNumber, formatPercent, formatWorkingDays } from "@/lib/formatting";
import { rubroLabel } from "@/lib/rubros";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ratesText, reviewWarnings, type CalculatorResult } from "@/components/budget/calculator-state";
import { cn } from "@/lib/utils";

export interface ReviewInfo {
  name: string;
  code: string;
  client: string;
  projectType: string;
  startDate: string;
  /** Fecha de entrega comprometida ("" = sin fecha). */
  dueDate: string;
}

const COLUMNS: Array<[keyof Pick<RubroTableRow, "materials" | "labor" | "design" | "admin">, string]> = [
  ["materials", "Materiales"],
  ["labor", "Mano de obra"],
  ["design", "Diseño"],
  ["admin", "Administración"],
];

const cell = (n: number) => (n === 0 ? "—" : formatCurrency(n));

export function QuoteReview({ info, calc, salesPrice }: { info: ReviewInfo; calc: CalculatorResult; salesPrice: number }) {
  const table = rubroTable(calc.lines);
  const profit = profitOrNull(salesPrice, calc.total);
  const margin = marginPercent(salesPrice - calc.total, salesPrice);
  const usesSuggested = calc.suggested !== null && salesPrice === calc.suggested.price;
  const warnings = reviewWarnings(calc, salesPrice);
  const { schedule } = calc;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{info.name}</CardTitle>
        <p className="text-sm text-slate-500">
          {info.code} · {info.client} · {info.projectType} · inicio {formatDate(info.startDate)}
          {info.dueDate ? ` · entrega comprometida ${formatDate(info.dueDate)}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-label="Resultado">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Big label="Precio de venta" value={salesPrice > 0 ? formatCurrency(salesPrice) : "Sin definir"} />
            <Big label="Costo presupuestado" value={formatCurrency(calc.total)} />
            <Big label="Ganancia esperada" value={formatCurrencyOrDash(profit)} />
            <Big label="Rentabilidad esperada" value={formatPercent(margin)} tone={margin !== null && margin < 15 ? "warn" : undefined} />
          </dl>
          {usesSuggested && calc.suggested && (
            <p className="mt-2 text-xs text-slate-500">
              Con el precio sugerido: rentabilidad de materiales {formatPercent(calc.suggested.materialsMargin)} · de mano de obra (incluye diseño y administración){" "}
              {formatPercent(calc.suggested.laborMargin)}.
            </p>
          )}
        </section>

        <section aria-label="Costo por rubro">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Costo presupuestado por rubro</h3>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Rubro</TH>
                  {COLUMNS.map(([, label]) => (
                    <TH key={label} className="text-right">{label}</TH>
                  ))}
                  <TH className="text-right">Total</TH>
                </TR>
              </THead>
              <TBody>
                {table.rows.map((r) => (
                  <TR key={r.rubro ?? "ajustes"}>
                    <TD className="font-medium text-slate-900">
                      {r.rubro ? rubroLabel(r.rubro) : "Ajustes por historial"}
                      {r.amount > 0 && r.amount !== r.total && <span className="block text-xs font-normal text-slate-500">incluye {formatCurrency(r.amount)} de importes</span>}
                    </TD>
                    {r.amount === r.total ? (
                      <TD colSpan={COLUMNS.length} className="text-right text-slate-500">importe</TD>
                    ) : (
                      COLUMNS.map(([key]) => (
                        <TD key={key} className="text-right tabular">{cell(r[key])}</TD>
                      ))
                    )}
                    <TD className="text-right font-medium tabular">{formatCurrency(r.total)}</TD>
                  </TR>
                ))}
                {table.financial > 0 && (
                  <TR>
                    <TD className="font-medium text-slate-900">Gasto financiero</TD>
                    <TD colSpan={COLUMNS.length} className="text-right text-slate-500">
                      {formatNumber(calc.input.financialPct, 2)}% del precio de venta
                    </TD>
                    <TD className="text-right font-medium tabular">{formatCurrency(table.financial)}</TD>
                  </TR>
                )}
                <TR className="bg-slate-50 font-semibold">
                  <TD colSpan={COLUMNS.length + 1}>Costo presupuestado</TD>
                  <TD className="text-right tabular">{formatCurrency(table.total)}</TD>
                </TR>
              </TBody>
            </Table>
          </div>
          <p className="mt-1 text-xs text-slate-500">Cada importe es la suma de las líneas que armó la calculadora en ese rubro (materiales, horas × tarifa e importes).</p>
        </section>

        <section aria-label="Supuestos" className="space-y-1 text-sm text-slate-600">
          <h3 className="text-sm font-semibold text-slate-900">Supuestos</h3>
          <p>
            Tarifas: {ratesText(calc.rates)}. Gasto financiero: {formatNumber(calc.input.financialPct, 2)}% del precio de venta.
          </p>
          <p>
            Días de trabajo estimados: {schedule.workDays > 0 ? formatWorkingDays(schedule.workDays) : "—"} (rubros uno detrás de otro: supuesto a confirmar).{" "}
            {schedule.fits === null ? "Sin fecha de entrega." : schedule.fits ? "Entra hasta la fecha de entrega." : "No entra hasta la fecha de entrega."}
          </p>
        </section>

        {warnings.length > 0 && (
          <section aria-label="Avisos" role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            <ul className="space-y-1">
              {warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">El proyecto se crea en Cotización. Podés editar el costo presupuestado hasta aprobarlo.</p>
      </CardContent>
    </Card>
  );
}

function Big({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cn("text-xl font-semibold tabular", tone === "warn" ? "text-amber-700" : "text-slate-900")}>{value}</dd>
    </div>
  );
}
