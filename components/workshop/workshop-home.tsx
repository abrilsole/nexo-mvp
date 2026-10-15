"use client";
// "Mi día" del Operario (Lote 5B): una encuesta corta, pensada para el celular.
// Las asignaciones del Jefe de planta vienen precargadas: el operario confirma o corrige las horas.
// "Agregar otro trabajo" = proyecto → rubro → horas. Sin plata y sin alertas de desvío.
import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Plus } from "lucide-react";
import type { Project, RubroId } from "@/types";
import { APP_NAME } from "@/lib/constants";
import { formatDate, formatNumber, todayISO } from "@/lib/formatting";
import { myDay, rubroOptions, type MyDayItem } from "@/lib/my-day";
import { activeOperators, operatorAccessForUser, projectsForOperator } from "@/lib/operators";
import { checkHours } from "@/lib/project-rules";
import { rubroLabel } from "@/lib/rubros";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { ModeSwitch } from "@/components/layout/mode-switch";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export function WorkshopHome() {
  const projects = useAppStore((s) => s.projects);
  const operators = useAppStore((s) => s.operators);
  const assignments = useAppStore((s) => s.assignments);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const setActingOperator = useAppStore((s) => s.setActingOperator);
  const userId = useAppStore((s) => s.userId);
  const userEmail = useAppStore((s) => s.userEmail);
  const isDemo = useAppStore((s) => s.isDemo);
  const { operator, realRole } = useIdentity();
  const isRealOperator = realRole === "operator";
  const [date, setDate] = useState(todayISO());
  const [saved, setSaved] = useState("");
  const [adding, setAdding] = useState(false);
  const access = isRealOperator ? operatorAccessForUser(operators, userId, userEmail) : null;
  const mine = useMemo(() => (operator ? projectsForOperator(projects, operator.id, operators) : []), [projects, operator, operators]);
  const day = useMemo(() => (operator ? myDay(projects, assignments, operator.id, date) : null), [projects, assignments, operator, date]);

  const done = (text: string) => {
    setSaved(text);
    setAdding(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white px-4 pb-12">
      <header className="flex items-center justify-between gap-3 py-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold tracking-tight">{APP_NAME}</div>
          <div className="break-words text-xs text-slate-500">Mi día{operator ? ` · ${operator.name}` : ""}</div>
        </div>
        {isRealOperator && (
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-blue-700">Cerrar sesión</button>
          </form>
        )}
      </header>

      {!isRealOperator && isDemo && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label htmlFor="acting-op" className="mb-1.5 block text-xs font-medium text-slate-600">Demo: ver el día de</label>
          <Select id="acting-op" value={operator?.id ?? ""} onChange={(e) => setActingOperator(e.target.value)}>
            {activeOperators(operators).map((o) => (
              <option key={o.id} value={o.id}>{o.name} · {o.role}</option>
            ))}
          </Select>
        </div>
      )}

      {!operator || !day ? (
        <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-900">
          {access === "deactivated"
            ? "Tu usuario está dado de baja como operario, así que no ves proyectos. Si es un error, pedile a un usuario Administrativo que te reactive."
            : isRealOperator
              ? "Tu usuario todavía no está vinculado a un operario. Pedile a un usuario Administrativo que te invite desde Configuración → Usuarios."
              : "Esta pantalla es la de los operarios."}
        </p>
      ) : (
        <>
          <div className="mb-4 flex items-end justify-between gap-3">
            <h1 className="text-2xl font-semibold">Mi día</h1>
            <div className="w-40">
              <label htmlFor="day" className="mb-1 block text-xs font-medium text-slate-600">Día</label>
              <Input id="day" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
            </div>
          </div>

          {saved && (
            <p role="status" className="mb-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden /> {saved}
            </p>
          )}

          <p className="mb-3 text-sm text-slate-600">
            {formatDate(date)}: cargaste <strong className="tabular">{formatNumber(day.total)} h</strong> de tu jornada de {formatNumber(hoursPerDay)} h.
          </p>

          <section aria-label="Lo que tenés asignado" className="space-y-3">
            {day.items.length === 0 ? (
              <p className="rounded-md bg-slate-100 p-4 text-sm text-slate-700">No tenés trabajos asignados para este día. Si trabajaste, agregalo abajo.</p>
            ) : (
              day.items.map((item) => <AssignmentCard key={item.assignment.id} item={item} date={date} onDone={done} />)
            )}
            {day.extra.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                <span className="min-w-0 break-words">
                  {projects.find((p) => p.id === e.projectId)?.code} · {e.rubro ? rubroLabel(e.rubro) : e.labor?.role}
                </span>
                <span className="shrink-0 font-medium tabular">{formatNumber(e.labor?.hours ?? 0)} h ✓</span>
              </div>
            ))}
          </section>

          {adding ? (
            <OtherWorkForm projects={mine} date={date} onCancel={() => setAdding(false)} onDone={done} />
          ) : (
            <Button variant="outline" size="xl" className="mt-4 w-full" onClick={() => setAdding(true)} disabled={mine.length === 0}>
              <Plus /> Agregar otro trabajo
            </Button>
          )}

          <section aria-label="Otras cargas" className="mt-8 border-t border-slate-200 pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Otras cargas</h2>
            <p className="mb-2 text-xs text-slate-500">Material usado, pedir material o dejar una nota o incidencia.</p>
            <ul className="space-y-2">
              {mine.map((p) => (
                <li key={p.id}>
                  <Link href={`/taller/${p.id}`} className="flex min-h-12 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-medium text-slate-500">{p.code}</span> {p.name}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {!isRealOperator && isDemo && (
        <div className="mt-8 border-t border-slate-200 pt-4">
          <ModeSwitch />
        </div>
      )}
    </div>
  );
}

/** Valida y guarda horas del operario (misma regla que la base: > 0, hasta 24 por día; aviso si pasa la jornada). */
function useSaveHours(date: string) {
  const logHours = useAppStore((s) => s.logHours);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const projects = useAppStore((s) => s.projects);
  const { operator } = useIdentity();
  return (input: { project: Project; rubro: RubroId; hours: number; assignmentId?: string; confirmed: boolean }) => {
    if (!operator) return { ok: false as const, error: "No hay operario." };
    const entries = projects.flatMap((p) => p.actualEntries);
    const check = checkHours(entries, operator.id, date, input.hours, todayISO(), hoursPerDay);
    if (check.level === "block") return { ok: false as const, error: check.message ?? "Horas inválidas." };
    if (check.level === "warn" && !input.confirmed) return { ok: false as const, warn: check.message ?? "" };
    const res = logHours(input.project.id, {
      date,
      hours: input.hours,
      workType: rubroLabel(input.rubro),
      rubro: input.rubro,
      assignmentId: input.assignmentId,
      confirmHighHours: true,
    });
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
  };
}

function AssignmentCard({ item, date, onDone }: { item: MyDayItem; date: string; onDone: (msg: string) => void }) {
  const [hours, setHours] = useState(String(item.assignment.plannedHours).replace(".", ","));
  const [warn, setWarn] = useState("");
  const [error, setError] = useState("");
  const save = useSaveHours(date);
  const id = `h-${item.assignment.id}`;

  const submit = (confirmed: boolean) => {
    const h = parseDecimal(hours);
    const r = save({ project: item.project, rubro: item.assignment.rubro, hours: h, assignmentId: item.assignment.id, confirmed });
    if ("warn" in r && r.warn) return setWarn(r.warn);
    if (!r.ok) return setError("error" in r ? (r.error ?? "") : "");
    setWarn("");
    setError("");
    onDone(`Guardamos ${formatNumber(h)} h en ${item.project.code} · ${rubroLabel(item.assignment.rubro)}.`);
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{item.project.code}</div>
      <div className="break-words font-semibold text-slate-900">{item.project.name}</div>
      <div className="mt-0.5 text-sm text-slate-600">
        {rubroLabel(item.assignment.rubro)} · previstas {formatNumber(item.assignment.plannedHours)} h
      </div>
      {item.done ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="size-4" aria-hidden /> Cargaste {formatNumber(item.logged)} h
        </p>
      ) : (
        <div className="mt-3 flex items-end gap-2">
          <div className="w-32">
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">Horas que trabajaste</label>
            <Input id={id} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} aria-invalid={!!error} />
          </div>
          <Button size="lg" className="flex-1" onClick={() => submit(false)}>
            Confirmar
          </Button>
        </div>
      )}
      <HoursFeedback warn={warn} error={error} onConfirm={() => submit(true)} />
    </div>
  );
}

function HoursFeedback({ warn, error, onConfirm }: { warn: string; error: string; onConfirm: () => void }) {
  if (error) return <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>;
  if (!warn) return null;
  return (
    <div role="alert" className="mt-2 space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
      <p>{warn}</p>
      <Button size="sm" variant="outline" onClick={onConfirm}>Sí, guardar igual</Button>
    </div>
  );
}

function OtherWorkForm({ projects, date, onCancel, onDone }: { projects: Project[]; date: string; onCancel: () => void; onDone: (msg: string) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId);
  const rubros = project ? rubroOptions(project) : [];
  const [rubro, setRubro] = useState<RubroId | "">("");
  const chosenRubro = rubro && rubros.includes(rubro) ? rubro : (rubros[0] ?? "");
  const [hours, setHours] = useState("");
  const [warn, setWarn] = useState("");
  const [error, setError] = useState("");
  const save = useSaveHours(date);

  const submit = (confirmed: boolean) => {
    if (!project || !chosenRubro) return setError("Elegí el proyecto y el rubro.");
    const h = parseDecimal(hours);
    const r = save({ project, rubro: chosenRubro, hours: h, confirmed });
    if ("warn" in r && r.warn) return setWarn(r.warn);
    if (!r.ok) return setError("error" in r ? (r.error ?? "") : "");
    onDone(`Guardamos ${formatNumber(h)} h en ${project.code} · ${rubroLabel(chosenRubro)}.`);
  };

  return (
    <form
      noValidate
      className="mt-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <h2 className="font-semibold">Otro trabajo</h2>
      <div>
        <label htmlFor="ow-project" className="mb-1 block text-sm font-medium text-slate-700">Proyecto</label>
        <Select id="ow-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="ow-rubro" className="mb-1 block text-sm font-medium text-slate-700">Rubro</label>
        <Select id="ow-rubro" value={chosenRubro} onChange={(e) => setRubro(e.target.value as RubroId)}>
          {rubros.map((r) => (
            <option key={r} value={r}>{rubroLabel(r)}</option>
          ))}
        </Select>
      </div>
      <div className="w-32">
        <label htmlFor="ow-hours" className="mb-1 block text-sm font-medium text-slate-700">Horas</label>
        <Input id="ow-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} aria-invalid={!!error} />
      </div>
      <HoursFeedback warn={warn} error={error} onConfirm={() => submit(true)} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" className="flex-1">Guardar</Button>
      </div>
    </form>
  );
}
