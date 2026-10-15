"use client";
// Crear o editar una asignación: proyecto, rubro, operario, día y horas previstas. Sin importes.
import { useState } from "react";
import type { RubroId, WorkAssignment } from "@/types";
import { activeOperators } from "@/lib/operators";
import { isAssignable } from "@/lib/plant";
import { rubroOptions } from "@/lib/my-day";
import { rubroLabel } from "@/lib/rubros";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type AssignmentDraft = Partial<Pick<WorkAssignment, "id" | "projectId" | "rubro" | "operatorId" | "date" | "plannedHours">>;

export function AssignmentDialog({ draft, onClose }: { draft: AssignmentDraft | null; onClose: () => void }) {
  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{draft && <AssignmentForm key={draft.id ?? `${draft.operatorId}-${draft.date}-${draft.projectId}`} draft={draft} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function AssignmentForm({ draft, onClose }: { draft: AssignmentDraft; onClose: () => void }) {
  const projects = useAppStore((s) => s.projects).filter(isAssignable);
  const operators = activeOperators(useAppStore((s) => s.operators));
  const saveAssignment = useAppStore((s) => s.saveAssignment);
  const removeAssignment = useAppStore((s) => s.removeAssignment);
  const [projectId, setProjectId] = useState(draft.projectId ?? projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId);
  const rubros = project ? rubroOptions(project) : [];
  const [rubro, setRubro] = useState<RubroId | "">(draft.rubro ?? "");
  const chosenRubro = rubro && rubros.includes(rubro) ? rubro : (rubros[0] ?? "");
  const [operatorId, setOperatorId] = useState(draft.operatorId ?? operators[0]?.id ?? "");
  const [date, setDate] = useState(draft.date ?? "");
  const [hours, setHours] = useState(draft.plannedHours ? String(draft.plannedHours).replace(".", ",") : "");
  const [error, setError] = useState("");

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosenRubro) return setError("Elegí el rubro.");
    const r = saveAssignment({ id: draft.id, projectId, rubro: chosenRubro, operatorId, date, plannedHours: parseDecimal(hours) });
    if (!r.ok) return setError(r.error);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{draft.id ? "Editar asignación" : "Nueva asignación"}</DialogTitle>
        <DialogDescription>El operario la ve precargada en &quot;Mi día&quot; y solo confirma o corrige las horas.</DialogDescription>
      </DialogHeader>
      <form onSubmit={save} noValidate className="space-y-4">
        <Field label="Proyecto" htmlFor="as-project">
          <Select id="as-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Rubro" htmlFor="as-rubro">
          <Select id="as-rubro" value={chosenRubro} onChange={(e) => setRubro(e.target.value as RubroId)}>
            {rubros.map((r) => (
              <option key={r} value={r}>{rubroLabel(r)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Operario" htmlFor="as-operator">
          <Select id="as-operator" value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name} · {o.role}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Día" htmlFor="as-date">
            <Input id="as-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Horas previstas" htmlFor="as-hours">
            <Input id="as-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <DialogFooter className="gap-2">
          {draft.id && (
            <Button
              type="button"
              variant="ghost"
              className="text-red-700 sm:mr-auto"
              onClick={() => {
                const r = removeAssignment(draft.id as string);
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
