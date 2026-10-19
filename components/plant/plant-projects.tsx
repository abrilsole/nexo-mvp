"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
// Jefe de planta → Proyectos (Lote 6): por producto, su estado y el contador de unidades terminadas (lo carga el
// Jefe de planta); por rubro, horas estimadas, operarios pedidos/asignados y horas cargadas; por operario,
// "cumplió / se pasó X h". Semáforo de entrega del proyecto. Sin importes.
import { useState } from "react";
import { ClipboardList, Minus, Plus, UserPlus } from "lucide-react";
import type { Project, ProjectItem } from "@/types";
import { formatDate, formatNumber } from "@/lib/formatting";
import { isAssignable, productRubroHours, thresholdOf, VERDICT_LABELS, type OperatorWork } from "@/lib/plant";
import { projectProduction, scheduleSignal } from "@/lib/production";
import { rubroLabel } from "@/lib/rubros";
import { useAppStore } from "@/store/use-app-store";
import { useMaterialsStateOf, useToday } from "@/store/selectors";
import { MaterialsBadge } from "@/components/purchasing/purchasing-projects";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductionBadge, ScheduleBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AssignmentDialog, type AssignmentDraft } from "./assignment-dialog";

export function PlantProjectsPage() {
  const projects = useAppStore((s) => s.projects);
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const list = projects.filter((p) => !p.isClosed && p.status !== "quotation").sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <div className="space-y-4">
      <PageHeader title="Proyectos" subtitle="Por producto: unidades terminadas, rubros, horas estimadas y cargadas, y cómo le fue a cada operario. Sin importes." />
      {list.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No hay proyectos en curso" description="Cuando se apruebe un proyecto, aparece acá." />
      ) : (
        list.map((p) => <ProjectCard key={p.id} project={p} onAssign={setDraft} />)
      )}
      <AssignmentDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function ProjectCard({ project: p, onAssign }: { project: Project; onAssign: (d: AssignmentDraft) => void }) {
  const today = useToday();
  const assignments = useAppStore((s) => s.assignments);
  const settings = useAppStore((s) => s.settings);
  const operators = useAppStore((s) => s.operators);
  const materialsOf = useMaterialsStateOf();
  const production = projectProduction(p);
  const schedule = scheduleSignal(p, today, settings.dueSoonDays);
  const rows = productRubroHours(p, assignments, thresholdOf(settings), today);
  const name = (id: string) => operators.find((o) => o.id === id)?.name ?? "Operario";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">{p.code}</span> {p.name} <StatusBadge status={p.status} /> <MaterialsBadge state={materialsOf(p)} />
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>Producción:</span> <ProductionBadge status={production.status} />
          <span className="tabular">avance {Math.round(production.progress * 100)} %</span>
          <span>· entrega {formatDate(p.dueDate)}</span> <ScheduleBadge view={schedule} />
        </div>
        <p className="text-xs text-slate-500">{schedule.reason}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {production.products.length === 0 ? (
          <p className="text-sm text-slate-500">El proyecto todavía no tiene productos cargados (los carga el Administrativo).</p>
        ) : (
          production.products.map(({ item, status }) => (
            <section key={item.id} aria-label={item.name} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                  {item.name} <span className="font-normal text-slate-500">× {item.quantity}</span> <ProductionBadge status={status} />
                </h3>
                <UnitsCounter project={p} item={item} />
              </div>
              <ul className="mt-2 divide-y divide-slate-100">
                {rows
                  .filter((r) => r.itemId === item.id)
                  .map((r) => {
                    const assigned = r.operators.filter((o) => assignments.some((a) => a.projectId === p.id && a.itemId === item.id && a.rubro === r.rubro && a.operatorId === o.operatorId)).length;
                    const missing = r.workers - assigned;
                    return (
                      <li key={r.rubro} className="space-y-1.5 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <strong className="text-slate-900">{rubroLabel(r.rubro)}</strong>
                          <span className="tabular text-slate-600">estimadas {formatNumber(r.estimated)} h</span>
                          <span className={cn("tabular", r.flagged ? "font-semibold text-red-700" : "text-slate-600")}>
                            cargadas {formatNumber(r.actual)} h{r.flagged && ` (+${formatNumber(r.over)} h)`}
                          </span>
                          <span className={cn("tabular", missing > 0 ? "font-semibold text-amber-800" : "text-slate-600")}>
                            operarios {assigned}/{r.workers}
                          </span>
                          {missing > 0 && isAssignable(p) && status !== "done" && (
                            <Button size="sm" variant="outline" onClick={() => onAssign({ projectId: p.id, itemId: item.id, rubro: r.rubro, date: today })}>
                              <UserPlus /> Asignar
                            </Button>
                          )}
                        </div>
                        {r.operators.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {r.operators.map((o) => (
                              <OperatorChip key={o.operatorId} name={name(o.operatorId)} work={o} />
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** "Juan: 44 de 30 h · se pasó 14 h". */
function OperatorChip({ name, work: o }: { name: string; work: OperatorWork }) {
  const tone = o.verdict === "over" ? "red" : o.verdict === "met" ? "green" : o.verdict === "short" ? "yellow" : "gray";
  const detail =
    o.verdict === "over"
      ? `se pasó ${formatNumber(o.diff)} h`
      : o.verdict === "short"
        ? `le faltaron ${formatNumber(-o.diff)} h`
        : o.verdict === "met"
          ? "cumplió"
          : VERDICT_LABELS.not_started.toLowerCase();
  return (
    <Badge tone={tone} title={`Previstas en sus asignaciones: ${formatNumber(o.planned)} h · cargadas: ${formatNumber(o.actual)} h${o.upcoming ? ` · por venir: ${formatNumber(o.upcoming)} h` : ""}`}>
      {name}: {formatNumber(o.actual)} de {formatNumber(o.planned)} h · {detail}
      {o.upcoming > 0 && ` · +${formatNumber(o.upcoming)} h asignadas`}
    </Badge>
  );
}

/** Contador de unidades terminadas (ej. 40/100). Solo Jefe de planta (o Administrativo). */
function UnitsCounter({ project, item }: { project: Project; item: ProjectItem }) {
  const setCompletedUnits = useConfirmedAction("setCompletedUnits");
  const [value, setValue] = useState(String(item.completedUnits));
  const [error, setError] = useState("");
  const save = async (n: number) => {
    const r = await setCompletedUnits(project.id, item.id, n);
    if (!r.ok) return setError(r.error);
    setError("");
    setValue(String(n));
  };
  const id = `units-${item.id}`;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">Terminadas</label>
        <Button size="icon" variant="outline" aria-label={`Una unidad menos de ${item.name}`} disabled={item.completedUnits <= 0} onClick={() => save(item.completedUnits - 1)}>
          <Minus />
        </Button>
        <Input
          id={id}
          inputMode="numeric"
          className="w-16 text-center tabular"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const n = Number(value);
            if (n !== item.completedUnits) save(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="text-sm tabular text-slate-600">/ {item.quantity}</span>
        <Button size="icon" variant="outline" aria-label={`Una unidad más de ${item.name}`} disabled={item.completedUnits >= item.quantity} onClick={() => save(item.completedUnits + 1)}>
          <Plus />
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
