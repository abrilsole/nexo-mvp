"use client";
// Paso "Revisar y crear" de Nuevo proyecto: todo sale del mismo resultado de la calculadora (sin recalcular
// ni duplicar números). Una sola vista: encabezado, tabla por rubro con los totales (desglose único), supuestos y avisos.
import { TriangleAlert } from "lucide-react";
import { rubroTable, type RubroTableRow } from "@/lib/budget-calculator";
import { formatCurrency, formatCurrencyOrDash, formatDate, formatNumber, formatPercent, formatWorkingDays } from "@/lib/formatting";
import { rubroLabel } from "@/lib/rubros";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ratesText, reviewWarnings, type CalculatorResult } from "@/components/budget/calculator-state";

export interface ReviewInfo {
  name: string;
  code: string;
  client: string;
  projectType: string;
  startDate: string;
  /** Fecha de entrega del proyecto ("" = sin fecha): se muestra como plazo estimado. */
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
  const b = calc.breakdown;
  const warnings = reviewWarnings(calc, salesPrice);
  const { schedule } = calc;
  const totalRow = (label: string, value: string, strong = false) => (
    <TR className={strong ? "bg-slate-50 font-semibold" : undefined}>
      <TD colSpan={COLUMNS.length + 1}>{label}</TD>
      <TD className="text-right tabular">{value}</TD>
    </TR>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{info.name}</CardTitle>
        <p className="text-sm text-slate-500">
          {info.code} · {info.client} · {info.projectType} · inicio {formatDate(info.startDate)}
          {info.dueDate ? ` · plazo estimado ${formatDate(info.dueDate)}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-label="Costo por rubro">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Costo presupuestado por rubro <span className="font-normal text-slate-500">(sin IVA)</span></h3>
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
                      {r.rubro ? rubroLabel(r.rubro) : "Margen de seguridad"}
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
                {totalRow("Costo total (sin IVA)", formatCurrency(table.total), true)}
                {totalRow("Precio (sin IVA)", salesPrice > 0 ? formatCurrency(salesPrice) : "Sin definir")}
                {totalRow("Ganancia", formatCurrencyOrDash(b.profit))}
                {totalRow(
                  b.usesSuggested
                    ? `Rentabilidad total (materiales ${formatPercent(b.materials.targetPct)} · mano de obra ${formatPercent(b.labor.targetPct)})`
                    : "Rentabilidad total",
                  formatPercent(b.margin),
                  true,
                )}
              </TBody>
            </Table>
          </div>
          <p className="mt-1 text-xs text-slate-500">Cada importe es la suma de las líneas que armó la calculadora en ese rubro (materiales, horas × tarifa e importes).</p>
        </section>

        <section aria-label="Supuestos" className="space-y-1 text-sm text-slate-600">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold text-slate-900">Supuestos</h3>
            <HelpTip label="Supuestos">
              Días de trabajo = horas por operario / jornada, sumando los rubros uno detrás de otro. Es un supuesto conservador, a confirmar con el cliente.
            </HelpTip>
          </div>
          <ul className="list-disc space-y-1 pl-5">
            <li>Tarifas: {ratesText(calc.rates)}.</li>
            <li>Jornada del operario: {formatNumber(calc.input.hoursPerDay, 1)} h por día.</li>
            <li>Gasto financiero: {formatNumber(calc.input.financialPct, 2)} % del precio de venta.</li>
            <li>Días de trabajo estimados: {schedule.workDays > 0 ? formatWorkingDays(schedule.workDays) : "—"}.</li>
            <li>
              {schedule.availableDays === null
                ? "Sin plazo: no hay horas extra."
                : `Plazo: ${formatWorkingDays(schedule.availableDays)}. ${schedule.fits ? "Los días de trabajo entran." : "Los días de trabajo no entran: hay horas extra."}`}
            </li>
          </ul>
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
