"use client";
// Calendario del Jefe de planta (Lote 6 · Fase 3): grilla operarios × días (lunes a domingo). Cada celda muestra horas
// asignadas / capacidad del día (ej. 6/8 h) y un chip por proyecto, uno al lado del otro, con el color del proyecto.
// Rojo si lo asignado pasa la capacidad; gris si no es día laborable (días del operario y excepciones). Sin importes.
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import type { Operator } from "@/types";
import { formatDate, formatNumber } from "@/lib/formatting";
import { addDays } from "@/lib/plant";
import { rubroLabel } from "@/lib/rubros";
import { calendarCell, fullWeek, PROJECT_COLORS, projectColorIndex, WEEKDAY_LABELS, dayOfWeek, type CalendarCell } from "@/lib/schedule";
import { useAppStore } from "@/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AssignmentDraft } from "./assignment-dialog";

export function PlantCalendar({ operators, today, onAssign }: { operators: Operator[]; today: string; onAssign: (d: AssignmentDraft) => void }) {
  const projects = useAppStore((s) => s.projects);
  const assignments = useAppStore((s) => s.assignments);
  const exceptions = useAppStore((s) => s.dayExceptions);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const [anchor, setAnchor] = useState(today);
  const week = fullWeek(anchor);
  const code = (id: string) => projects.find((p) => p.id === id)?.code ?? id;
  const shown = new Set(week.flatMap((d) => assignments.filter((a) => a.date === d).map((a) => a.projectId)));

  const cellView = (o: Operator, d: string) => {
    const cell = calendarCell(o, d, assignments, exceptions, hoursPerDay);
    return <Cell key={d} cell={cell} operator={o} isToday={d === today} code={code} colorOf={(id) => PROJECT_COLORS[projectColorIndex(id, projects)]} onAssign={onAssign} />;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>
            Calendario: semana del {formatDate(week[0])} al {formatDate(week[6])}
          </CardTitle>
          <p className="text-sm text-slate-500">
            Cada celda: horas asignadas / capacidad del día. <span className="font-medium text-red-700">Rojo</span>: se pasa de su capacidad.{" "}
            <span className="font-medium text-slate-600">Gris</span>: no es día laborable (días y excepciones en Operarios).
          </p>
        </div>
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
      <CardContent className="space-y-3">
        {shown.size > 0 && (
          <ul aria-label="Proyectos de la semana" className="flex flex-wrap gap-1.5 text-xs">
            {[...shown].sort((a, b) => code(a).localeCompare(code(b))).map((id) => (
              <li key={id} className={cn("rounded border px-1.5 py-0.5", PROJECT_COLORS[projectColorIndex(id, projects)])}>
                {code(id)} · {projects.find((p) => p.id === id)?.name}
              </li>
            ))}
          </ul>
        )}
        {/* Celular: un bloque por operario con sus 7 días. Pantallas anchas: la grilla. */}
        <div className="space-y-3 sm:hidden">
          {operators.map((o) => (
            <section key={o.id} aria-label={o.name} className="rounded-lg border border-slate-200 p-2">
              <h3 className="mb-1 text-sm font-semibold text-slate-900">{o.name}</h3>
              <div className="grid grid-cols-2 gap-1">
                {week.map((d) => (
                  <div key={d}>
                    <p className="text-[11px] text-slate-500">
                      {WEEKDAY_LABELS[dayOfWeek(d)]} {formatDate(d).slice(0, 5)}
                    </p>
                    {cellView(o, d)}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full border-separate border-spacing-1 text-sm" aria-label="Calendario operarios por día">
            <thead>
              <tr>
                <th className="w-36 text-left text-xs font-medium text-slate-500">Operario</th>
                {week.map((d) => (
                  <th key={d} className={cn("min-w-32 text-left text-xs font-medium text-slate-500", d === today && "text-blue-800")}>
                    {WEEKDAY_LABELS[dayOfWeek(d)]} {formatDate(d).slice(0, 5)}
                    {d === today && " (hoy)"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {operators.map((o) => (
                <tr key={o.id} className="align-top">
                  <th scope="row" className="pr-2 text-left font-medium text-slate-900">
                    {o.name}
                    <span className="block text-xs font-normal text-slate-500">{o.role}</span>
                  </th>
                  {week.map((d) => (
                    <td key={d}>{cellView(o, d)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Cell({
  cell,
  operator,
  isToday,
  code,
  colorOf,
  onAssign,
}: {
  cell: CalendarCell;
  operator: Operator;
  isToday: boolean;
  code: (id: string) => string;
  colorOf: (projectId: string) => string;
  onAssign: (d: AssignmentDraft) => void;
}) {
  const assignments = useAppStore((s) => s.assignments);
  const off = !cell.capacity.working;
  const label = `${operator.name}, ${formatDate(cell.date)}: ${formatNumber(cell.planned)} de ${formatNumber(cell.capacity.hours)} h${off ? " (no laborable)" : ""}${cell.over ? `, se pasa ${formatNumber(cell.overBy)} h` : ""}`;
  return (
    <div
      role="group"
      aria-label={label}
      title={cell.capacity.reason}
      data-state={cell.over ? "over" : off ? "off" : "ok"}
      className={cn(
        "min-h-16 rounded-md border p-1.5",
        cell.over ? "border-red-400 bg-red-50" : off ? "border-slate-200 bg-slate-100" : "border-slate-200 bg-white",
        isToday && !cell.over && !off && "border-blue-300",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={cn("text-xs tabular", cell.over ? "font-semibold text-red-700" : off ? "text-slate-500" : "text-slate-600")}>
          {off && cell.planned === 0 ? "No trabaja" : `${formatNumber(cell.planned)}/${formatNumber(cell.capacity.hours)} h`}
        </span>
        <button
          type="button"
          onClick={() => onAssign({ operatorId: operator.id, date: cell.date })}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-blue-700"
          aria-label={`Asignar a ${operator.name} el ${formatDate(cell.date)}`}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {cell.capacity.exception && <p className="text-[11px] text-slate-500">{cell.capacity.exception.note ?? (off ? "Excepción: no trabaja" : "Excepción: trabaja")}</p>}
      {cell.chips.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {cell.chips.map((c) => {
            const first = assignments.find((a) => a.id === c.assignmentIds[0]);
            const rubros = c.assignmentIds.map((id) => assignments.find((a) => a.id === id)).filter((a) => a !== undefined).map((a) => rubroLabel(a.rubro));
            return (
              <button
                key={c.projectId}
                type="button"
                onClick={() => first && onAssign(first)}
                title={`${code(c.projectId)} · ${[...new Set(rubros)].join(", ")} · ${formatNumber(c.hours)} h`}
                aria-label={`Editar ${code(c.projectId)} ${formatNumber(c.hours)} h de ${operator.name} el ${formatDate(cell.date)}`}
                className={cn("rounded border px-1.5 py-0.5 text-[11px] font-medium tabular hover:ring-1 hover:ring-blue-400", colorOf(c.projectId))}
              >
                {code(c.projectId)} {formatNumber(c.hours)} h
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
