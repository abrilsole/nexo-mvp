"use client";
// Jefe de planta: Resumen, Proyectos, Operarios y Alertas. Sin importes: ni costos, ni precios, ni rentabilidad.
import { HoursReviews } from "./hours-review";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CalendarDays, ClipboardList, UsersRound } from "lucide-react";
import { formatDate, formatNumber } from "@/lib/formatting";
import { activeOperators, visibleOperators } from "@/lib/operators";
import { pendingAssignments } from "@/lib/plant";
import { calendarCell, workDaysLabel, workDaysOf } from "@/lib/schedule";
import { plantView } from "@/lib/role-views";
import { rubroLabel } from "@/lib/rubros";
import { useAppStore } from "@/store/use-app-store";
import { usePlantAlerts, useToday } from "@/store/selectors";
import { AlertItem } from "@/components/alerts/alert-item";
import { StatLink } from "@/components/shared/stat";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ScheduleDialog } from "./schedule-dialog";

export function PlantSummaryPage() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const operators = activeOperators(useAppStore((s) => s.operators));
  const assignments = useAppStore((s) => s.assignments);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const alerts = usePlantAlerts();
  const pending = useMemo(() => pendingAssignments(projects, assignments, today), [projects, assignments, today]);
  const todays = assignments.filter((a) => a.date === today);
  const exceptions = useAppStore((s) => s.dayExceptions);
  const loads = operators.map((o) => ({ o, load: calendarCell(o, today, assignments, exceptions, hoursPerDay) }));
  const label = (projectId: string, itemId: string | undefined) => {
    const p = projects.find((x) => x.id === projectId);
    return `${p?.code ?? projectId} · ${p?.items.find((i) => i.id === itemId)?.name ?? "producto"}`;
  };
  const deviations = alerts.filter((a) => a.kind === "hours");

  return (
    <div className="space-y-6">
      <PageHeader title="Resumen de planta" subtitle={`Hoy, ${formatDate(today)}. Jornada: ${formatNumber(hoursPerDay)} h.`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatLink icon={CalendarClock} label="Asignaciones de hoy" value={String(todays.length)} href="/planta/asignaciones" />
        <StatLink icon={UsersRound} label="Operarios pasados de su capacidad hoy" value={String(loads.filter((l) => l.load.over).length)} href="/planta/asignaciones" tone={loads.some((l) => l.load.over) ? "warn" : undefined} />
        <StatLink icon={ClipboardList} label="Pendientes de asignar" value={String(pending.length)} href="/planta/asignaciones" tone={pending.length ? "warn" : undefined} />
        <StatLink icon={AlertTriangle} label="Alertas de planta" value={String(alerts.length)} href="/planta/alertas" tone={alerts.length ? "warn" : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hoy en planta</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-slate-100">
            {loads.map(({ o, load }) => (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 break-words">
                  <strong>{o.name}</strong> <span className="text-slate-500">· {o.role}</span>
                  <span className="block text-xs text-slate-600">
                    {todays.filter((a) => a.operatorId === o.id).map((a) => `${label(a.projectId, a.itemId)} · ${rubroLabel(a.rubro)} · ${formatNumber(a.plannedHours)} h`).join(" — ") || "Sin asignación"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs tabular text-slate-500" title={load.capacity.reason}>
                    {formatNumber(load.planned)}/{formatNumber(load.capacity.hours)} h
                  </span>
                  {!load.capacity.working && <Badge tone="gray">No trabaja hoy</Badge>}
                  {load.over && <Badge tone="red">Se pasa {formatNumber(load.overBy)} h</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <section aria-label="Desvíos de horas" className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Desvíos de horas (producto + rubro)</h2>
        {deviations.length === 0 ? (
          <p className="text-sm text-slate-500">Ningún producto superó las horas estimadas.</p>
        ) : (
          deviations.map((a) => <AlertItem key={a.id} alert={a} readOnly compact />)
        )}
        <Link href="/planta/alertas" className="text-sm text-blue-700 hover:underline">Ver todas las alertas de planta</Link>
      </section>
    </div>
  );
}

export function PlantOperatorsPage() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const allOperators = useAppStore((s) => s.operators);
  const assignments = useAppStore((s) => s.assignments);
  const exceptions = useAppStore((s) => s.dayExceptions);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const operators = visibleOperators(allOperators, showInactive);
  const view = useMemo(() => plantView(projects, operators), [projects, operators]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Operarios"
        subtitle={`Especialidad, días laborales (con sus excepciones) y disponibilidad. La capacidad de un día laboral es la jornada de ${formatNumber(hoursPerDay)} h (Configuración). Sin costos.`}
      />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="size-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Ver también los dados de baja
      </label>
      <Card>
        <CardContent className="overflow-x-auto pt-5">
          <Table>
            <THead>
              <TR>
                <TH>Operario</TH>
                <TH>Días laborales</TH>
                <TH>Excepciones próximas</TH>
                <TH>Hoy</TH>
                <TH className="text-right">Horas cargadas</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {view.operators.map((o) => {
                const cell = calendarCell(o, today, assignments, exceptions, hoursPerDay);
                const next = exceptions.filter((x) => x.operatorId === o.id && x.date >= today);
                return (
                  <TR key={o.id} className="align-top">
                    <TD className="font-medium text-slate-900">
                      {o.name}
                      <span className="block text-xs font-normal text-slate-500">{o.role}</span>
                      {!o.active && <Badge tone="gray">De baja</Badge>}
                    </TD>
                    <TD className="text-sm">{workDaysLabel(workDaysOf(o))}</TD>
                    <TD className="text-xs">
                      {next.length === 0
                        ? "—"
                        : next.map((x) => (
                            <div key={x.date} className="break-words">
                              {formatDate(x.date)}: {x.works ? `trabaja ${formatNumber(x.hours ?? hoursPerDay)} h` : "no trabaja"}
                              {x.note && <span className="text-slate-500"> ({x.note})</span>}
                            </div>
                          ))}
                    </TD>
                    <TD className="whitespace-nowrap tabular text-sm">
                      {!o.active ? "—" : (
                        <span className={cn(cell.over && "font-semibold text-red-700", !cell.capacity.working && "text-slate-500")} title={cell.capacity.reason}>
                          {cell.capacity.working || cell.planned > 0 ? `${formatNumber(cell.planned)}/${formatNumber(cell.capacity.hours)} h` : "No trabaja"}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular">{formatNumber(o.hours)} h</TD>
                    <TD className="text-right">
                      {o.active && (
                        <Button size="sm" variant="outline" onClick={() => setEditing(o.id)} aria-label={`Días laborales de ${o.name}`}>
                          <CalendarDays /> Días
                        </Button>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <ScheduleDialog operatorId={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

export function PlantAlertsPage() {
  const alerts = usePlantAlerts();
  return (
    <div className="space-y-4">
      <HoursReviews />
      <PageHeader title="Alertas de planta" subtitle="Desvío de horas, operarios sobrecargados y rubros sin asignar a pocos días de la entrega." />
      {alerts.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Sin alertas de planta" description="Cuando haya desvíos de horas o falte asignar a alguien, aparece acá." />
      ) : (
        alerts.map((a) => <AlertItem key={a.id} alert={a} readOnly />)
      )}
    </div>
  );
}
