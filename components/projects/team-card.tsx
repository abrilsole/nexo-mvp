"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useState } from "react";
import type { Project } from "@/types";
import { formatCurrency } from "@/lib/formatting";
import { activeOperators } from "@/lib/operators";
import { useAppStore } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TeamCard({ project }: { project: Project }) {
  const operators = useAppStore((s) => s.operators);
  const assignOperators = useConfirmedAction("assignOperators");
  const { isManager } = useIdentity();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(project.assignedOperatorIds);
  const [error, setError] = useState("");
  const hours = new Map<string, { hours: number; cost: number }>();
  for (const e of project.actualEntries) {
    if (e.type !== "labor" || !e.operatorId) continue;
    const cur = hours.get(e.operatorId) ?? { hours: 0, cost: 0 };
    hours.set(e.operatorId, { hours: cur.hours + (e.labor?.hours ?? 0), cost: cur.cost + e.amount });
  }
  const assigned = operators.filter((o) => project.assignedOperatorIds.includes(o.id));

  const save = async () => {
    const r = await assignOperators(project.id, sel);
    if (!r.ok) return setError(r.error);
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Equipo asignado</CardTitle>
          <CardDescription>Sólo estos operarios ven el proyecto en su día y pueden cargar horas.</CardDescription>
        </div>
        {isManager && !project.isClosed && (
          <Button size="sm" variant="outline" onClick={() => { setSel(project.assignedOperatorIds); setError(""); setOpen(true); }}>
            Editar equipo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {assigned.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay operarios asignados.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {assigned.map((o) => {
              const h = hours.get(o.id);
              return (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span><span className="font-medium text-slate-900">{o.name}</span> <span className="text-slate-500">· {o.role}{o.active ? "" : " (dado de baja)"}</span></span>
                  <span className="tabular text-slate-600">{h ? `${h.hours} h · ${formatCurrency(h.cost)}` : "Sin horas"}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Equipo de {project.code}</DialogTitle>
            <DialogDescription>Elegí quiénes trabajan en este proyecto. Los operarios dados de baja no aparecen y, al guardar, dejan de estar asignados.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1">
            {activeOperators(operators).map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={sel.includes(o.id)}
                    onChange={(e) => setSel(e.target.checked ? [...sel, o.id] : sel.filter((x) => x !== o.id))}
                  />
                  <span className="font-medium text-slate-900">{o.name}</span>
                  <span className="text-slate-500">{o.role}</span>
                </label>
              </li>
            ))}
            {activeOperators(operators).length === 0 && <li className="text-sm text-slate-500">Primero cargá operarios activos en la sección Operarios.</li>}
          </ul>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
