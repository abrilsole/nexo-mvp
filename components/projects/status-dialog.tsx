"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useState } from "react";
import type { Project, ProjectStatus } from "@/types";
import { STATUS_LABELS } from "@/lib/constants";
import { nextStatus, previousStatuses } from "@/lib/project-rules";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const NOTES: Partial<Record<ProjectStatus, string>> = {
  approved: "Al aprobar, el costo presupuestado queda guardado como presupuesto base (línea base): no se modifica, solo se compara.",
  purchasing: "En la etapa Compras se registran las compras y se asigna material al proyecto.",
  production: "Desde Producción, los operarios asignados pueden registrar horas y consumos.",
};

/** Cambio de etapa de a un paso. Volver atrás es una corrección y pide confirmación. */
export function StatusDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const changeProjectStatus = useConfirmedAction("changeProjectStatus");
  const [error, setError] = useState("");
  const [back, setBack] = useState<ProjectStatus | "">("");
  const next = nextStatus(project.status);
  const prev = previousStatuses(project.status);

  const go = async (to: ProjectStatus, confirmBack = false) => {
    const r = await changeProjectStatus(project.id, to, { confirmBack });
    if (!r.ok) return setError(r.error);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setError(""); setBack(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar etapa</DialogTitle>
          <DialogDescription>Ahora: <strong>{STATUS_LABELS[project.status]}</strong>. Las etapas se avanzan de a una. Para finalizar usá “Cerrar proyecto”.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {next ? (
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">Pasar a {STATUS_LABELS[next]}</p>
              {NOTES[next] && <p className="mt-1 text-sm text-slate-600">{NOTES[next]}</p>}
              <Button className="mt-3" onClick={() => go(next)}>Pasar a {STATUS_LABELS[next]}</Button>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Es la última etapa de ejecución. Cuando termine, cerrá el proyecto.</p>
          )}
          {prev.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
              <p className="text-sm font-medium text-amber-900">Corregir: volver a una etapa anterior</p>
              {back === "" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {prev.map((s) => (
                    <Button key={s} size="sm" variant="outline" onClick={() => setBack(s)}>{STATUS_LABELS[s]}</Button>
                  ))}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-amber-900">
                    ¿Confirmás volver a <strong>{STATUS_LABELS[back]}</strong>? Queda registrado como corrección. {back === "quotation" || back === "approved" ? "Los operarios dejan de poder cargar registros." : ""}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setBack("")}>No</Button>
                    <Button size="sm" onClick={() => go(back, true)}>Sí, volver a {STATUS_LABELS[back]}</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
