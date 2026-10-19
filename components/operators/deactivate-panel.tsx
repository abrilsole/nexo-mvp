"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo, useState } from "react";
import type { Operator } from "@/types";
import { STATUS_LABELS } from "@/lib/constants";
import { activeOperators, openProjectsOf, reassignmentPlanError, type ReassignmentPlan } from "@/lib/operators";
import { useAppStore } from "@/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

/** Valor del selector para "Sin asignar" (en el plan se guarda como null). */
const NONE = "__none__";

/**
 * Confirmación de la baja. Si el operario está en proyectos no finalizados, cada uno necesita un destino
 * (otro operario activo o "Sin asignar") antes de habilitar "Sí, dar de baja".
 */
export function DeactivatePanel({ operator, onCancel, onDone }: { operator: Operator; onCancel: () => void; onDone: () => void }) {
  const projects = useAppStore((s) => s.projects);
  const operators = useAppStore((s) => s.operators);
  const requests = useAppStore((s) => s.requests);
  const deactivateOperator = useConfirmedAction("deactivateOperator");
  const open = useMemo(() => openProjectsOf(projects, operator.id), [projects, operator.id]);
  const candidates = useMemo(() => activeOperators(operators).filter((o) => o.id !== operator.id), [operators, operator.id]);
  const openRequests = requests.filter((r) => r.status === "open" && r.requestedBy === operator.name).length;
  /** projectId → "" (sin elegir) | NONE | id de operario */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [all, setAll] = useState("");
  const [error, setError] = useState("");

  const plan: ReassignmentPlan = {};
  for (const p of open) {
    const v = choice[p.id] ?? "";
    if (v) plan[p.id] = v === NONE ? null : v;
  }
  const ready = reassignmentPlanError(operators, projects, operator.id, plan) === null;

  const applyAll = (v: string) => {
    setAll(v);
    if (v) setChoice(Object.fromEntries(open.map((p) => [p.id, v])));
  };

  const confirm = async () => {
    const r = await deactivateOperator(operator.id, plan);
    if (!r.ok) return setError(r.error);
    onDone();
  };

  const options = (
    <>
      <option value="">Elegí un destino</option>
      {candidates.map((o) => (
        <option key={o.id} value={o.id}>{o.name} ({o.role})</option>
      ))}
      <option value={NONE}>Sin asignar</option>
    </>
  );

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-800">
        ¿Dar de baja a <strong>{operator.name}</strong>? Deja de aparecer en los equipos y ya no puede entrar como Operario. Sus horas y costos registrados no cambian.
        Podés reactivarlo cuando quieras.
      </p>

      {open.length > 0 && (
        <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-3">
          <p className="font-medium text-amber-900">
            Está asignado a {open.length === 1 ? "1 proyecto en curso" : `${open.length} proyectos en curso`}. Elegí quién lo reemplaza en cada uno, o dejalo “Sin asignar”.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="reassign-all" className="text-xs font-medium text-slate-600">Reasignar todos a…</label>
            <Select id="reassign-all" value={all} onChange={(e) => applyAll(e.target.value)}>{options}</Select>
          </div>
          <ul className="space-y-2">
            {open.map((p) => (
              <li key={p.id} className="space-y-1.5 rounded-md bg-white p-2 ring-1 ring-slate-200">
                <label htmlFor={`reassign-${p.id}`} className="min-w-0">
                  <span className="font-medium text-slate-900">{p.code}</span> · <span className="break-words">{p.name}</span>
                  <span className="block text-xs text-slate-500">Etapa: {STATUS_LABELS[p.status]}</span>
                </label>
                <Select
                  id={`reassign-${p.id}`}
                  value={choice[p.id] ?? ""}
                  onChange={(e) => {
                    setAll("");
                    setChoice({ ...choice, [p.id]: e.target.value });
                  }}
                >
                  {options}
                </Select>
              </li>
            ))}
          </ul>
          {candidates.length === 0 && <p className="text-xs text-slate-600">No hay otros operarios activos: podés dejar los proyectos “Sin asignar”.</p>}
          <p className="text-xs text-slate-600">Un proyecto en ejecución que quede sin operarios muestra la alerta “Proyecto sin operario asignado” hasta que asignes a alguien.</p>
        </div>
      )}

      {openRequests > 0 && (
        <p className="text-slate-600">
          Tiene {openRequests === 1 ? "1 pedido de material abierto" : `${openRequests} pedidos de material abiertos`}: siguen visibles para Administrativo en Stock → Pedidos de taller.
        </p>
      )}

      {error && <p role="alert" className="text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>No, volver</Button>
        <Button type="button" variant="destructive" size="sm" disabled={!ready} onClick={confirm}>Sí, dar de baja</Button>
      </div>
      {!ready && <p className="text-xs text-slate-500">Para confirmar, elegí un destino para cada proyecto.</p>}
    </div>
  );
}
