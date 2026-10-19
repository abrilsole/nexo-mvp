"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo, useRef, useState } from "react";
import { createId } from "@/lib/activity";
import type { Project, RubroId } from "@/types";
import { HOURS_MAX_PER_DAY, checkHours } from "@/lib/project-rules";
import { parseDecimal } from "@/lib/schemas";
import { formatCurrency, formatNumber, todayISO } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { rubroLabel } from "@/lib/rubros";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { QuantityInput } from "@/components/workshop/quantity-input";
import { cn } from "@/lib/utils";

/**
 * Carga manual de horas desde Administrativo (el Operario carga en "Mi día"). Toda hora es de un producto + rubro
 * (Lote 6): al guardar se crea la asignación de ese día y las horas quedan contra ella. El costo/hora sale de la
 * ficha del operario, vigente ese día: no se tipea.
 */
export function HoursForm({ project, onDone }: { project: Project; onDone: (summary: string) => void }) {
  const identity = useIdentity();
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const projects = useAppStore((s) => s.projects);
  const operators = useAppStore((s) => s.operators);
  const logHoursManual = useConfirmedAction("logHoursManual");

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
  const [itemId, setItemId] = useState(project.items[0]?.id ?? "");
  const item = project.items.find((i) => i.id === itemId);
  const [rubro, setRubro] = useState<RubroId | "">("");
  const chosenRubro = item?.rubros.some((r) => r.rubro === rubro) ? rubro : (item?.rubros[0]?.rubro ?? "");
  const [comment, setComment] = useState("");
  const [confirmHigh, setConfirmHigh] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);

  const isOperator = identity.role === "operator";
  const operator = isOperator ? identity.operator : operators.find((o) => o.id === pickedOperator);
  const hoursN = parseDecimal(hours || "0");
  const check = operator && Number.isFinite(hoursN) && hoursN > 0 ? checkHours(projects.flatMap(p=>p.actualEntries), operator.id, date, hoursN, todayISO(), hoursPerDay) : null;

  const submit = async () => {
    if (!operator) return setError(isOperator ? "Tu usuario no está vinculado a un operario." : "Elegí el operario.");
    if (!item || !chosenRubro) return setError("Elegí el producto y el rubro.");
    if (!Number.isFinite(hoursN) || hoursN <= 0) return setError("Indicá las horas trabajadas.");
    if (check?.level === "block") return setError(check.message ?? "Horas inválidas.");
    if (check?.level === "warn" && !confirmHigh) return setError("Confirmá que las horas son correctas.");
    requestId.current ??= createId("act");
    const res = await logHoursManual(project.id, {
      requestId: requestId.current,
      operatorId: operator.id,
      itemId: item.id,
      rubro: chosenRubro,
      date,
      hours: hoursN,
      comment: comment.trim() || undefined,
      confirmHighHours: confirmHigh,
    });
    if (!res.ok) return setError(res.error);
    requestId.current = null;
    onDone(`${formatNumber(hoursN, 1)} h de ${item.name} · ${rubroLabel(chosenRubro)} · ${operator.name}`);
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

      {project.items.length === 0 ? (
        <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Este proyecto todavía no tiene productos. Cargalos en la pestaña “Productos y archivos” (con sus rubros y horas estimadas) para poder cargar horas.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="h-item" className={label}>Producto</label>
            <Select id="h-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {project.items.map((i) => (
                <option key={i.id} value={i.id}>{i.name} × {i.quantity}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="h-rubro" className={label}>Rubro</label>
            <Select id="h-rubro" value={chosenRubro} onChange={(e) => setRubro(e.target.value as RubroId)}>
              {(item?.rubros ?? []).map((r) => (
                <option key={r.rubro} value={r.rubro}>{rubroLabel(r.rubro)}</option>
              ))}
            </Select>
          </div>
        </div>
      )}

      <QuantityInput id="h-hours" label="Horas" value={hours} onChange={setHours} unit="h" step={0.5} />

      <div>
        <label htmlFor="h-date" className={label}>Fecha</label>
        <Input id="h-date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

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
