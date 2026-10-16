"use client";
// Jefe de planta: Resumen, Proyectos, Operarios y Alertas. Sin importes: ni costos, ni precios, ni rentabilidad.
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ClipboardList, UsersRound } from "lucide-react";
import { formatDate, formatNumber } from "@/lib/formatting";
import { activeOperators, visibleOperators } from "@/lib/operators";
import { dayLoad, pendingAssignments, workWeek } from "@/lib/plant";
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
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export function PlantSummaryPage() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const operators = activeOperators(useAppStore((s) => s.operators));
  const assignments = useAppStore((s) => s.assignments);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const alerts = usePlantAlerts();
  const pending = useMemo(() => pendingAssignments(projects, assignments, today), [projects, assignments, today]);
  const todays = assignments.filter((a) => a.date === today);
  const loads = operators.map((o) => ({ o, load: dayLoad(assignments, o.id, today, hoursPerDay) }));
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
        <StatLink icon={UsersRound} label="Operarios con horas extra hoy" value={String(loads.filter((l) => l.load.overloaded).length)} href="/planta/asignaciones" tone={loads.some((l) => l.load.overloaded) ? "warn" : undefined} />
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
                  <span className="text-xs tabular text-slate-500">
                    {formatNumber(load.planned)}/{formatNumber(hoursPerDay)} h
                  </span>
                  {load.overloaded && <Badge tone="yellow">+{formatNumber(load.overtimeHours)} h extra</Badge>}
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
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const [showInactive, setShowInactive] = useState(false);
  const operators = visibleOperators(allOperators, showInactive);
  const view = useMemo(() => plantView(projects, operators), [projects, operators]);
  const week = workWeek(today);
  const code = (id: string) => projects.find((p) => p.id === id)?.code ?? id;

  return (
    <div className="space-y-4">
      <PageHeader title="Operarios" subtitle="Especialidad, disponibilidad y asignaciones de la semana. Sin costos." />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="size-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Ver también los dados de baja
      </label>
      <Card>
        <CardContent className="overflow-x-auto pt-5">
          <Table>
            <THead>
              <TR>
                <TH>Operario</TH>
                <TH>Disponible hoy</TH>
                {week.map((d) => (
                  <TH key={d} className="min-w-28">{formatDate(d).slice(0, 5)}</TH>
                ))}
                <TH className="text-right">Horas cargadas</TH>
              </TR>
            </THead>
            <TBody>
              {view.operators.map((o) => {
                const load = dayLoad(assignments, o.id, today, hoursPerDay);
                return (
                  <TR key={o.id} className="align-top">
                    <TD className="font-medium text-slate-900">
                      {o.name}
                      <span className="block text-xs font-normal text-slate-500">{o.role}</span>
                      {!o.active && <Badge tone="gray">De baja</Badge>}
                    </TD>
                    <TD className="whitespace-nowrap tabular">
                      {o.active ? (load.overloaded ? <Badge tone="yellow">+{formatNumber(load.overtimeHours)} h extra</Badge> : `${formatNumber(Math.max(0, hoursPerDay - load.planned))} h`) : "—"}
                    </TD>
                    {week.map((d) => (
                      <TD key={d} className="text-xs">
                        {assignments
                          .filter((a) => a.operatorId === o.id && a.date === d)
                          .map((a) => (
                            <div key={a.id} className="break-words">
                              {code(a.projectId)} · {formatNumber(a.plannedHours)} h
                            </div>
                          ))}
                      </TD>
                    ))}
                    <TD className="text-right tabular">{formatNumber(o.hours)} h</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function PlantAlertsPage() {
  const alerts = usePlantAlerts();
  return (
    <div className="space-y-4">
      <PageHeader title="Alertas de planta" subtitle="Desvío de horas, operarios sobrecargados y rubros sin asignar a pocos días de la entrega." />
      {alerts.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Sin alertas de planta" description="Cuando haya desvíos de horas o falte asignar a alguien, aparece acá." />
      ) : (
        alerts.map((a) => <AlertItem key={a.id} alert={a} readOnly />)
      )}
    </div>
  );
}
