"use client";
// Jefe de planta → Asignaciones: semana operario × día, carga de cada operario (horas extra según la jornada de
// Configuración, misma regla del Cotizador) y rubros pendientes de asignar. Sin importes.
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import type { Project, WorkAssignment } from "@/types";
import type { MaterialsState } from "@/lib/purchasing";
import { formatDate, formatNumber } from "@/lib/formatting";
import { activeOperators } from "@/lib/operators";
import { addDays, dayLoad, pendingAssignments, workWeek } from "@/lib/plant";
import { rubroLabel } from "@/lib/rubros";
import { useAppStore } from "@/store/use-app-store";
import { useMaterialsStateOf, useToday } from "@/store/selectors";
import { MaterialsBadge } from "@/components/purchasing/purchasing-projects";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AssignmentDialog, type AssignmentDraft } from "./assignment-dialog";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie"];

export function AssignmentsPage() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const operators = activeOperators(useAppStore((s) => s.operators));
  const assignments = useAppStore((s) => s.assignments);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const [anchor, setAnchor] = useState(today);
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const week = workWeek(anchor);
  const pending = useMemo(() => pendingAssignments(projects, assignments, today), [projects, assignments, today]);
  const code = (id: string) => projects.find((p) => p.id === id)?.code ?? id;
  const materialsOf = useMaterialsStateOf();
  const projectOf = (id: string) => projects.find((p) => p.id === id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asignaciones"
        subtitle={`Quién trabaja en qué proyecto y rubro cada día. Jornada: ${formatNumber(hoursPerDay)} h (Configuración); lo que pasa la jornada son horas extra.`}
        actions={
          <Button onClick={() => setDraft({ date: today })}>
            <Plus /> Nueva asignación
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Semana del {formatDate(week[0])} al {formatDate(week[4])}
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(week[0], -7))} aria-label="Semana anterior">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>Esta semana</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(week[0], 7))} aria-label="Semana siguiente">
              <ChevronRight />
            </Button>
          </div>
        </CardHeader>
        {/* Celular: un bloque por día. Pantallas anchas: la grilla operario × día. */}
        <CardContent className="space-y-4 sm:hidden">
          {week.map((d, i) => (
            <section key={d} aria-label={`${WEEKDAYS[i]} ${formatDate(d)}`} className={cn("rounded-lg border border-slate-200 p-3", d === today && "border-blue-300 bg-blue-50/40")}>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                {WEEKDAYS[i]} {formatDate(d)}
                {d === today && <span className="ml-1 font-normal text-blue-800">(hoy)</span>}
              </h3>
              <ul className="space-y-2">
                {operators.map((o) => {
                  const mine = assignments.filter((a) => a.operatorId === o.id && a.date === d);
                  const load = dayLoad(assignments, o.id, d, hoursPerDay);
                  return (
                    <li key={o.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{o.name}</span>
                        {load.planned > 0 && <span className="text-xs tabular text-slate-500">{formatNumber(load.planned)}/{formatNumber(hoursPerDay)} h</span>}
                        {load.overloaded && <Badge tone="yellow">+{formatNumber(load.overtimeHours)} h extra</Badge>}
                        <button
                          type="button"
                          onClick={() => setDraft({ operatorId: o.id, date: d })}
                          className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-700"
                          aria-label={`Asignar a ${o.name} el ${formatDate(d)}`}
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                      {mine.map((a) => (
                        <div key={a.id} className="mt-1">
                          <AssignmentChip assignment={a} code={code(a.projectId)} onEdit={() => setDraft(a)} />
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </CardContent>
        <CardContent className="hidden overflow-x-auto sm:block">
          <Table>
            <THead>
              <TR>
                <TH>Operario</TH>
                {week.map((d, i) => (
                  <TH key={d} className={cn("min-w-36", d === today && "text-blue-800")}>
                    {WEEKDAYS[i]} {formatDate(d).slice(0, 5)}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {operators.map((o) => (
                <TR key={o.id} className="align-top">
                  <TD className="font-medium text-slate-900">
                    {o.name}
                    <span className="block text-xs font-normal text-slate-500">{o.role}</span>
                  </TD>
                  {week.map((d) => {
                    const mine = assignments.filter((a) => a.operatorId === o.id && a.date === d);
                    const load = dayLoad(assignments, o.id, d, hoursPerDay);
                    return (
                      <TD key={d} className={cn(d === today && "bg-blue-50/40")}>
                        <ul className="space-y-1">
                          {mine.map((a) => (
                            <li key={a.id}>
                              <AssignmentChip assignment={a} code={code(a.projectId)} onEdit={() => setDraft(a)} />
                            </li>
                          ))}
                        </ul>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {load.planned > 0 && (
                            <span className={cn("text-xs tabular", load.overloaded ? "font-semibold text-amber-800" : "text-slate-500")}>
                              {formatNumber(load.planned)}/{formatNumber(hoursPerDay)} h
                            </span>
                          )}
                          {load.overloaded && <Badge tone="yellow">+{formatNumber(load.overtimeHours)} h extra</Badge>}
                          <button
                            type="button"
                            onClick={() => setDraft({ operatorId: o.id, date: d })}
                            className="ml-auto rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-blue-700"
                            aria-label={`Asignar a ${o.name} el ${formatDate(d)}`}
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pendientes de asignar</CardTitle>
          <p className="text-sm text-slate-500">Producto + rubro donde se pidieron más operarios de los que hay asignados. Primero lo que se entrega antes. Cuando todo está asignado, la lista queda vacía.</p>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-slate-500">Todo está asignado: no queda nada pendiente.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pending.map((r) => (
                <li key={`${r.projectId}-${r.itemId}-${r.rubro}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-words">
                    <strong>{r.projectCode}</strong> {r.projectName} · <strong>{r.itemName}</strong> · {rubroLabel(r.rubro)}{" "}
                    <PendingMaterials project={projectOf(r.projectId)} state={materialsOf} />
                    <span className="block text-xs text-slate-500">
                      Pide {r.workers} {r.workers === 1 ? "operario" : "operarios"} · asignados {r.assigned} · {formatNumber(r.hours)} h estimadas · entrega {formatDate(r.dueDate)}
                      {r.daysLeft < 0 ? " (vencida)" : ` (faltan ${r.daysLeft} días)`}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setDraft({ projectId: r.projectId, itemId: r.itemId, rubro: r.rubro, date: today })}>
                    <Pencil /> Asignar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AssignmentDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function AssignmentChip({ assignment: a, code, onEdit }: { assignment: WorkAssignment; code: string; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full items-start justify-between gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-left text-xs hover:border-blue-400"
      aria-label={`Editar ${code} ${rubroLabel(a.rubro)} ${formatNumber(a.plannedHours)} h`}
    >
      <span className="min-w-0 break-words">
        <strong>{code}</strong> · {rubroLabel(a.rubro)}
      </span>
      <span className="shrink-0 tabular">{formatNumber(a.plannedHours)} h</span>
    </button>
  );
}

function PendingMaterials({ project, state }: { project: Project | undefined; state: (p: Project) => MaterialsState | null }) {
  return project ? <MaterialsBadge state={state(project)} /> : null;
}
