"use client";
// Administrativo → Horas (Lote 5B): estimadas vs reales por operario, por rubro y por proyecto, con la
// diferencia, el % y el costo de esas horas (solo el Administrativo ve importes).
import { useMemo } from "react";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatting";
import { hoursReport, type HoursRow } from "@/lib/hours-report";
import { thresholdOf } from "@/lib/plant";
import { useAppStore } from "@/store/use-app-store";
import { usePlantAlerts, useToday } from "@/store/selectors";
import { AlertItem } from "@/components/alerts/alert-item";
import { PageHeader } from "@/components/shared/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function HoursTable({
  title,
  column,
  help,
  rows,
  estimatedLabel,
  withEstimatedCost,
}: {
  title: string;
  column: string;
  help: string;
  rows: HoursRow[];
  estimatedLabel: string;
  withEstimatedCost: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          {title} <HelpTip label={title}>{help}</HelpTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay horas para comparar.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{column}</TH>
                <TH className="text-right">{estimatedLabel}</TH>
                <TH className="text-right">Reales</TH>
                <TH className="text-right">Diferencia</TH>
                <TH className="text-right">%</TH>
                {withEstimatedCost && <TH className="text-right">Costo estimado</TH>}
                <TH className="text-right">Costo real</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.key}>
                  <TD className="font-medium text-slate-900">{r.label}</TD>
                  <TD className="whitespace-nowrap text-right tabular">{formatNumber(r.estimated)} h</TD>
                  <TD className="whitespace-nowrap text-right tabular">{formatNumber(r.actual)} h</TD>
                  <TD className={cn("whitespace-nowrap text-right tabular", r.flagged && "font-semibold text-amber-800")}>
                    {r.diff > 0 ? "+" : ""}
                    {formatNumber(r.diff)} h
                  </TD>
                  <TD className={cn("whitespace-nowrap text-right tabular", r.flagged && "font-semibold text-amber-800")}>{r.pct === null ? "—" : `${r.pct > 0 ? "+" : ""}${formatPercent(r.pct, 0)}`}</TD>
                  {withEstimatedCost && <TD className="whitespace-nowrap text-right tabular">{r.estimatedCost === null ? "—" : formatCurrency(r.estimatedCost)}</TD>}
                  <TD className="whitespace-nowrap text-right tabular">{formatCurrency(r.actualCost)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function HoursPage() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const assignments = useAppStore((s) => s.assignments);
  const operators = useAppStore((s) => s.operators);
  const settings = useAppStore((s) => s.settings);
  const alerts = usePlantAlerts().filter((a) => a.kind === "hours");
  const report = useMemo(() => hoursReport({ projects, assignments, operators, today, threshold: thresholdOf(settings) }), [projects, assignments, operators, today, settings]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Horas"
        subtitle={`Estimadas vs reales. En ámbar, lo que se pasa más de ${formatNumber(settings.hoursDeviationPct)} % o ${formatNumber(settings.hoursDeviationHours)} h (Configuración → Alertas; supuesto a ajustar).`}
      />
      <HoursTable
        title="Por operario"
        column="Operario"
        help="Horas previstas en las asignaciones del Jefe de planta hasta hoy vs las que el operario cargó esos días en esos proyectos y rubros. El costo real es el de cada registro, con el costo vigente ese día."
        rows={report.byOperator}
        estimatedLabel="Previstas"
        withEstimatedCost={false}
      />
      <HoursTable
        title="Por rubro"
        column="Rubro"
        help="Horas de mano de obra estimadas en el presupuesto vs las cargadas, sumando todos los proyectos en curso o cerrados."
        rows={report.byRubro}
        estimatedLabel="Estimadas"
        withEstimatedCost
      />
      <HoursTable
        title="Por proyecto"
        column="Proyecto"
        help="Horas de mano de obra estimadas en el presupuesto del proyecto vs las cargadas."
        rows={report.byProject}
        estimatedLabel="Estimadas"
        withEstimatedCost
      />
      {alerts.length > 0 && (
        <section aria-label="Desvíos de horas" className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Desvíos de horas</h2>
          {alerts.map((a) => (
            <AlertItem key={a.id} alert={a} />
          ))}
        </section>
      )}
    </div>
  );
}
