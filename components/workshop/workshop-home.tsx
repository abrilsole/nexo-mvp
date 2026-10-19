"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
// "Mi día" del Operario (Lote 6): lo mínimo posible, pensado para el celular.
// Solo lo asignado a esa persona para HOY: proyecto, producto, rubro y horas estimadas de la tarea,
// con un único campo de horas y "Guardar". Sin plata, sin otros proyectos, sin unidades y sin alertas.
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { formatDate, formatNumber, todayISO } from "@/lib/formatting";
import { createId } from "@/lib/activity";
import { myDay, type MyDayItem } from "@/lib/my-day";
import { activeOperators, operatorAccessForUser } from "@/lib/operators";
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
  const setActingOperator = useAppStore((s) => s.setActingOperator);
  const userId = useAppStore((s) => s.userId);
  const userEmail = useAppStore((s) => s.userEmail);
  const isDemo = useAppStore((s) => s.isDemo);
  const { operator, realRole } = useIdentity();
  const isRealOperator = realRole === "operator";
  const today = todayISO();
  const [saved, setSaved] = useState("");
  const access = isRealOperator ? operatorAccessForUser(operators, userId, userEmail) : null;
  const day = useMemo(() => (operator ? myDay(projects, assignments, operator.id, today) : null), [projects, assignments, operator, today]);

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
          <h1 className="text-2xl font-semibold">Hoy, {formatDate(today)}</h1>
          {saved && (
            <p role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden /> {saved}
            </p>
          )}
          <section aria-label="Lo que tenés asignado hoy" className="mt-4 space-y-3">
            {day.items.length === 0 ? (
              <p className="rounded-md bg-slate-100 p-4 text-sm text-slate-700">Hoy no tenés trabajos asignados. Si trabajaste en algo, avisale al Jefe de planta.</p>
            ) : (
              day.items.map((item) => <AssignmentCard key={item.assignment.id} item={item} onSaved={setSaved} />)
            )}
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

/** Una asignación de hoy: proyecto, producto, rubro y horas estimadas; un solo campo de horas y Guardar. */
function AssignmentCard({ item, onSaved }: { item: MyDayItem; onSaved: (msg: string) => void }) {
  const logHours = useConfirmedAction("logHours");
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const projects = useAppStore((s) => s.projects);
  const [hours, setHours] = useState("");
  const [warn, setWarn] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const busy = useAppStore((s) => s.syncStatus === "saving");
  const a = item.assignment;
  const id = `h-${a.id}`;

  const submit = async (confirmed: boolean) => {
    const h = parseDecimal(hours);
    // Misma regla que la base: más de 0 y hasta 24 por persona y día; pasar la jornada es un aviso.
    const check = checkHours(projects.flatMap((p) => p.actualEntries), a.operatorId, a.date, h, todayISO(), hoursPerDay);
    if (check.level === "block") return setError(check.message ?? "Horas inválidas.");
    if (check.level === "warn" && !confirmed) return setWarn(check.message ?? "");
    requestId.current ??= createId("act");
    const r = await logHours(item.project.id, { requestId: requestId.current, assignmentId: a.id, hours: h, confirmHighHours: true });
    if (!r.ok) return setError(r.error);
    requestId.current = null;
    setHours("");
    setWarn("");
    setError("");
    onSaved(`Guardamos ${formatNumber(h)} h en ${item.item?.name ?? item.project.name} · ${rubroLabel(a.rubro)}.`);
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{item.project.code} · {item.project.name}</div>
      <div className="mt-0.5 break-words text-lg font-semibold text-slate-900">{item.item?.name ?? "Producto"}</div>
      <div className="text-sm text-slate-600">
        {a.hourKind === "design" ? "Diseño" : a.hourKind === "admin" ? "Administración" : rubroLabel(a.rubro)} · estimadas <strong className="tabular">{formatNumber(a.plannedHours)} h</strong>
      </div>
      {item.logged > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="size-4" aria-hidden /> Cargaste {formatNumber(item.logged)} h
        </p>
      )}
        <form
          noValidate
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <div className="w-32">
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">{item.logged > 0 ? "Agregar horas" : "Horas trabajadas"}</label>
            <Input id={id} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} aria-invalid={!!error} />
          </div>
          <Button type="submit" size="lg" className="flex-1" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
        </form>
      <Link href={`/taller/${item.project.id}`} className="mt-3 block text-xs text-blue-700 underline">Materiales o incidencias de este proyecto</Link>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {warn && !error && (
        <div role="alert" className="mt-2 space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <p>{warn}</p>
          <Button size="sm" variant="outline" onClick={() => submit(true)}>Sí, guardar igual</Button>
        </div>
      )}
    </div>
  );
}
