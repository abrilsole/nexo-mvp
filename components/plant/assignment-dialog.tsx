"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
// Asignar trabajo: proyecto → producto → rubro → operario(s) → días → horas por día. Sin importes.
// Al crear se pueden elegir varias personas y un rango de días (una asignación por persona y día hábil);
// al editar se cambia esa sola asignación.
import { useState } from "react";
import type { RubroId, WorkAssignment } from "@/types";
import { activeOperators } from "@/lib/operators";
import { formatDate, formatNumber } from "@/lib/formatting";
import { isAssignable } from "@/lib/plant";
import { calendarCell, operatorWorkdays } from "@/lib/schedule";
import { rubroLabel } from "@/lib/rubros";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { useMaterialsStateOf } from "@/store/selectors";
import { MATERIALS_STATE_LABELS } from "@/lib/purchasing";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type AssignmentDraft = Partial<Pick<WorkAssignment, "id" | "projectId" | "itemId" | "rubro" | "operatorId" | "date" | "plannedHours" | "hourKind">>;

export function AssignmentDialog({ draft, onClose }: { draft: AssignmentDraft | null; onClose: () => void }) {
  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {draft && <AssignmentForm key={draft.id ?? `${draft.operatorId}-${draft.date}-${draft.projectId}-${draft.itemId}-${draft.rubro}`} draft={draft} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function AssignmentForm({ draft, onClose }: { draft: AssignmentDraft; onClose: () => void }) {
  const projects = useAppStore((s) => s.projects).filter(isAssignable);
  const operators = activeOperators(useAppStore((s) => s.operators));
  const saveAssignment = useConfirmedAction("saveAssignment");
  const removeAssignment = useConfirmedAction("removeAssignment");
  const editing = !!draft.id;
  const [hourKind, setHourKind] = useState<"labor" | "design" | "admin">(draft.hourKind ?? "labor");
  const materialsOf = useMaterialsStateOf();
  const [projectId, setProjectId] = useState(draft.projectId ?? projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId);
  const [itemId, setItemId] = useState(draft.itemId ?? "");
  const item = project?.items.find((i) => i.id === itemId) ?? project?.items[0];
  const [rubro, setRubro] = useState<RubroId | "">(draft.rubro ?? "");
  const chosenRubro = item?.rubros.some((r) => r.rubro === rubro) ? rubro : (item?.rubros[0]?.rubro ?? "");
  const need = item?.rubros.find((r) => r.rubro === chosenRubro);
  const [picked, setPicked] = useState<string[]>(draft.operatorId ? [draft.operatorId] : []);
  const [from, setFrom] = useState(draft.date ?? "");
  const [to, setTo] = useState(draft.date ?? "");
  const [hours, setHours] = useState(draft.plannedHours ? String(draft.plannedHours).replace(".", ",") : "8");
  const [error, setError] = useState("");
  const exceptions = useAppStore((s) => s.dayExceptions);
  const assignments = useAppStore((s) => s.assignments);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  // Cada operario, en SUS días laborales (días de la semana y excepciones). Al editar, el día elegido.
  const daysFor = (operatorId: string): string[] => {
    if (editing) return from ? [from] : [];
    const o = operators.find((x) => x.id === operatorId);
    return from && to && o ? operatorWorkdays(o, exceptions, from, to) : [];
  };
  const total = picked.reduce((s, id) => s + daysFor(id).length, 0);
  // Avisos (no bloquean): día no laborable o capacidad superada.
  const planned = parseDecimal(hours) || 0;
  const warnings = picked.flatMap((id) => {
    const o = operators.find((x) => x.id === id);
    if (!o) return [];
    const dates = editing ? daysFor(id) : from && to && from === to ? [from] : [];
    return dates.flatMap((d) => {
      const others = assignments.filter((a) => a.id !== draft.id);
      const cell = calendarCell(o, d, [...others, { id: "nueva", projectId, rubro: "carpinteria_madera", operatorId: id, date: d, plannedHours: planned, createdBy: "", createdAt: "" }], exceptions, hoursPerDay);
      if (!cell.capacity.working) return [`${o.name} no trabaja el ${formatDate(d)} (${cell.capacity.reason.toLowerCase()}).`];
      if (cell.over) return [`${o.name} quedaría con ${formatNumber(cell.planned)} h el ${formatDate(d)}: su capacidad es ${formatNumber(cell.capacity.hours)} h.`];
      return [];
    });
  });

  const toggle = (id: string) => (editing ? setPicked([id]) : setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !chosenRubro) return setError("Elegí el producto y el rubro.");
    if (picked.length === 0) return setError("Elegí al menos un operario.");
    if (total === 0) return setError(editing ? "Elegí el día." : "Elegí desde y hasta qué día: en ese rango no hay días laborales de esas personas.");
    for (const operatorId of picked) {
      for (const date of daysFor(operatorId)) {
        const r = await saveAssignment({ id: draft.id, projectId, itemId: item.id, rubro: chosenRubro, operatorId, date, plannedHours: parseDecimal(hours), hourKind });
        if (!r.ok) return setError(r.error);
      }
    }
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Editar asignación" : "Asignar trabajo"}</DialogTitle>
        <DialogDescription>Cada persona lo ve en &quot;Mi día&quot; con las horas estimadas y solo carga las horas que trabajó.</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} noValidate className="space-y-4">
        <Field label="Tipo de trabajo" htmlFor="as-kind"><Select id="as-kind" value={hourKind} onChange={e=>setHourKind(e.target.value as typeof hourKind)}><option value="labor">Producción</option><option value="design">Diseño</option><option value="admin">Administración</option></Select></Field>
        <Field label="Proyecto" htmlFor="as-project">
          <Select id="as-project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setItemId(""); }}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Producto" htmlFor="as-item">
            <Select id="as-item" value={item?.id ?? ""} onChange={(e) => setItemId(e.target.value)}>
              {(project?.items ?? []).map((i) => (
                <option key={i.id} value={i.id}>{i.name} × {i.quantity}</option>
              ))}
            </Select>
          </Field>
          <Field label="Rubro" htmlFor="as-rubro">
            <Select id="as-rubro" value={chosenRubro} onChange={(e) => setRubro(e.target.value as RubroId)}>
              {(item?.rubros ?? []).map((r) => (
                <option key={r.rubro} value={r.rubro}>{rubroLabel(r.rubro)}</option>
              ))}
            </Select>
          </Field>
        </div>
        {project && materialsOf(project) && materialsOf(project) !== "complete" && (
          <p role="status" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            Materiales del proyecto: {MATERIALS_STATE_LABELS[materialsOf(project) ?? "none"].toLowerCase()}. Podés asignar igual; avisale a Compras si hace falta.
          </p>
        )}
        {need && (
          <p className="text-xs text-slate-500">
            Estimado: {need.hours} h en total · pide {need.workers} {need.workers === 1 ? "operario" : "operarios"}.
          </p>
        )}
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">{editing ? "Operario" : "Operarios"}</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {operators.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
                <input type={editing ? "radio" : "checkbox"} name="as-operator" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} className="size-4" />
                <span className="min-w-0 break-words">{o.name} <span className="text-xs text-slate-500">· {o.role}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-3 gap-3">
          <Field label={editing ? "Día" : "Desde"} htmlFor="as-from">
            <Input id="as-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value); }} />
          </Field>
          {!editing && (
            <Field label="Hasta" htmlFor="as-to">
              <Input id="as-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          )}
          <Field label="Horas por día" htmlFor="as-hours">
            <Input id="as-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
        </div>
        {!editing && total > 0 && (
          <p className="text-xs text-slate-600">
            Se crean {total} asignaciones ({picked.length} {picked.length === 1 ? "persona" : "personas"}, cada una en sus días laborales del rango).
          </p>
        )}
        {warnings.length > 0 && (
          <ul role="status" className="space-y-0.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <DialogFooter className="gap-2">
          {editing && (
            <Button
              type="button"
              variant="ghost"
              className="text-red-700 sm:mr-auto"
              onClick={async () => {
                const r = await removeAssignment(draft.id as string);
                if (!r.ok) return setError(r.error);
                onClose();
              }}
            >
              Quitar asignación
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Guardar</Button>
        </DialogFooter>
      </form>
    </>
  );
}
