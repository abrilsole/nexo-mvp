"use client";
// Jefe de planta → Asignaciones: calendario operarios × días (capacidad según los días laborales de cada operario y sus
// excepciones, Lote 6 · Fase 3) y producto + rubro pendientes de asignar. Sin importes.
import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { Project } from "@/types";
import type { MaterialsState } from "@/lib/purchasing";
import { formatDate, formatNumber } from "@/lib/formatting";
import { activeOperators } from "@/lib/operators";
import { pendingAssignments } from "@/lib/plant";
import { rubroLabel } from "@/lib/rubros";
import { useAppStore } from "@/store/use-app-store";
import { useMaterialsStateOf, useToday } from "@/store/selectors";
import { MaterialsBadge } from "@/components/purchasing/purchasing-projects";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssignmentDialog, type AssignmentDraft } from "./assignment-dialog";
import { PlantCalendar } from "./plant-calendar";

export function AssignmentsPage() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const operators = activeOperators(useAppStore((s) => s.operators));
  const assignments = useAppStore((s) => s.assignments);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const pending = useMemo(() => pendingAssignments(projects, assignments, today), [projects, assignments, today]);
  const materialsOf = useMaterialsStateOf();
  const projectOf = (id: string) => projects.find((p) => p.id === id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asignaciones"
        subtitle={`Quién trabaja en qué proyecto cada día. Capacidad: la jornada de ${formatNumber(hoursPerDay)} h (Configuración) en los días laborales de cada operario, o lo que diga su excepción.`}
        actions={
          <Button onClick={() => setDraft({ date: today })}>
            <Plus /> Nueva asignación
          </Button>
        }
      />

      <PlantCalendar operators={operators} today={today} onAssign={setDraft} />

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

function PendingMaterials({ project, state }: { project: Project | undefined; state: (p: Project) => MaterialsState | null }) {
  return project ? <MaterialsBadge state={state(project)} /> : null;
}
