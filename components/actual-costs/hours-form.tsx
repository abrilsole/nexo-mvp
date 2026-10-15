"use client";
import { useMemo, useState } from "react";
import type { Project, RubroId, StageKey } from "@/types";
import { STATUS_LABELS } from "@/lib/constants";
import { EXECUTION_STATUSES, HOURS_MAX_PER_DAY, checkHours } from "@/lib/project-rules";
import { parseDecimal } from "@/lib/schemas";
import { formatCurrency, formatNumber, todayISO } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { rubroOptions } from "@/lib/my-day";
import { rubroLabel } from "@/lib/rubros";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { QuantityInput } from "@/components/workshop/quantity-input";
import { cn } from "@/lib/utils";

/**
 * Carga de horas desde Administrativo (el Operario carga en "Mi día"). Las horas van por RUBRO del proyecto
 * (Lote 5B). El costo/hora sale de la ficha del operario, vigente ese día: no se tipea.
 */
export function HoursForm({ project, onDone }: { project: Project; onDone: (summary: string) => void }) {
  const identity = useIdentity();
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const rubros = rubroOptions(project);
  const operators = useAppStore((s) => s.operators);
  const logHours = useAppStore((s) => s.logHours);
  const assignOperators = useAppStore((s) => s.assignOperators);

  const choices = useMemo(
    () =>
      operators
        .filter((o) => o.active)
        .sort((a, b) => Number(project.assignedOperatorIds.includes(b.id)) - Number(project.assignedOperatorIds.includes(a.id)) || a.name.localeCompare(b.name, "es")),
    [operators, project.assignedOperatorIds],
  );
  const [pickedOperator, setPickedOperator] = useState(choices.find((o) => project.assignedOperatorIds.includes(o.id))?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState("");
  const [rubro, setRubro] = useState<RubroId | "">("");
  const [stage, setStage] = useState<StageKey>(EXECUTION_STATUSES.includes(project.status) ? (project.status as StageKey) : "production");
  const [itemId, setItemId] = useState("");
  const [comment, setComment] = useState("");
  const [confirmHigh, setConfirmHigh] = useState(false);
  const [error, setError] = useState("");

  const isOperator = identity.role === "operator";
  const operator = isOperator ? identity.operator : operators.find((o) => o.id === pickedOperator);
  const hoursN = parseDecimal(hours || "0");
  const check = operator && Number.isFinite(hoursN) && hoursN > 0 ? checkHours(project.actualEntries, operator.id, date, hoursN, todayISO(), hoursPerDay) : null;

  const submit = () => {
    if (!operator) return setError(isOperator ? "Tu usuario no está vinculado a un operario." : "Elegí el operario.");
    if (!rubro) return setError("Elegí el rubro.");
    if (!Number.isFinite(hoursN) || hoursN <= 0) return setError("Indicá las horas trabajadas.");
    if (check?.level === "block") return setError(check.message ?? "Horas inválidas.");
    if (check?.level === "warn" && !confirmHigh) return setError("Confirmá que las horas son correctas.");
    if (!isOperator && !project.assignedOperatorIds.includes(operator.id)) {
      // Gestión carga horas de alguien que todavía no estaba asignado: se lo asigna al proyecto.
      const r = assignOperators(project.id, [...project.assignedOperatorIds, operator.id]);
      if (!r.ok) return setError(r.error);
    }
    const res = logHours(project.id, {
      operatorId: isOperator ? undefined : operator.id,
      date,
      hours: hoursN,
      workType: rubroLabel(rubro),
      rubro,
      stage,
      itemId: itemId || undefined,
      comment: comment.trim() || undefined,
      confirmHighHours: confirmHigh,
    });
    if (!res.ok) return setError(res.error);
    onDone(`${formatNumber(hoursN, 1)} h de ${rubroLabel(rubro)}${isOperator ? "" : ` · ${operator.name}`}`);
  };

  const label = "mb-1.5 block text-sm font-medium text-slate-800";

  if (isOperator && !identity.operator) {
    return (
      <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-900" role="alert">
        Tu usuario todavía no está vinculado a un operario. Pedile a un usuario Administrativo que te invite desde Configuración → Usuarios.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {isOperator ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          Horas de <strong>{operator?.name}</strong>
        </p>
      ) : (
        <div>
          <label htmlFor="h-op" className={label}>Operario</label>
          <Select id="h-op" value={pickedOperator} onChange={(e) => setPickedOperator(e.target.value)}>
            <option value="">Elegí un operario…</option>
            {choices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
                {project.assignedOperatorIds.includes(o.id) ? "" : " (sin asignar al proyecto)"}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div>
        <label htmlFor="h-rubro" className={label}>Rubro</label>
        <Select id="h-rubro" value={rubro} onChange={(e) => setRubro(e.target.value as RubroId)}>
          <option value="">Elegí el rubro…</option>
          {rubros.map((r) => (
            <option key={r} value={r}>{rubroLabel(r)}</option>
          ))}
        </Select>
      </div>

      <QuantityInput id="h-hours" label="Horas" value={hours} onChange={setHours} unit="h" step={0.5} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="h-date" className={label}>Fecha</label>
          <Input id="h-date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="h-stage" className={label}>Etapa</label>
          <Select id="h-stage" value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
            {EXECUTION_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </Select>
        </div>
      </div>

      {project.items.length > 0 && (
        <div>
          <label htmlFor="h-item" className={label}>
            ¿Para qué mueble? <span className="font-normal text-slate-500">(opcional)</span>
          </label>
          <Select id="h-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">General del proyecto</option>
            {project.items.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </Select>
        </div>
      )}

      <div>
        <label htmlFor="h-comment" className={label}>
          Comentario <span className="font-normal text-slate-500">(opcional)</span>
        </label>
        <Textarea id="h-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>

      {check && check.level !== "ok" && (
        <div role="alert" className={cn("rounded-md p-3 text-sm", check.level === "block" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-900")}>
          {check.message}
          {check.level === "warn" && (
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={confirmHigh} onChange={(e) => setConfirmHigh(e.target.checked)} className="size-4" />
              Sí, son correctas
            </label>
          )}
        </div>
      )}

      {operator && hoursN > 0 && (
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          Costo: <strong className="tabular">{formatCurrency(hoursN * operator.hourlyCost)}</strong>
          <span className="text-slate-500"> ({formatNumber(hoursN, 1)} h × {formatCurrency(operator.hourlyCost)} de la ficha de {operator.name})</span>
        </div>
      )}
      <p className="text-xs text-slate-500">Máximo {HOURS_MAX_PER_DAY} horas por persona y día.</p>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button className="w-full" onClick={submit}>
        Guardar horas
      </Button>
    </div>
  );
}
