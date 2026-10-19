"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo, useState } from "react";
import { HardHat, Plus, Trash2, UserCheck, UserMinus } from "lucide-react";
import type { Operator } from "@/types";
import { parseDecimal } from "@/lib/schemas";
import { formatCurrency, formatDate, formatNumber, todayISO } from "@/lib/formatting";
import { activeOperators, operatorHasRecords, visibleOperators } from "@/lib/operators";
import { useAppStore, type Result } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DeactivatePanel } from "./deactivate-panel";
import { PriceHistoryList } from "@/components/settings/price-history-list";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Confirm = "deactivate" | "delete" | null;

function OperatorDialog({ operator, hasRecords, open, onOpenChange }: { operator: Operator | null; hasRecords: boolean; open: boolean; onOpenChange: (o: boolean) => void }) {
  const createOperator = useConfirmedAction("createOperator");
  const updateOperator = useConfirmedAction("updateOperator");
  const reactivateOperator = useConfirmedAction("reactivateOperator");
  const deleteOperator = useConfirmedAction("deleteOperator");
  const [name, setName] = useState(operator?.name ?? "");
  const [role, setRole] = useState(operator?.role ?? "");
  const [rate, setRate] = useState(operator ? String(operator.hourlyCost) : "");
  const [email, setEmail] = useState(operator?.email ?? "");
  const [validFrom, setValidFrom] = useState(todayISO());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [error, setError] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = { name, role, hourlyCost: parseDecimal(rate), email: email.trim() || undefined, userId: operator?.userId };
    const r = operator ? await updateOperator(operator.id, input, validFrom) : await createOperator(input);
    if (!r.ok) return setError(r.error);
    onOpenChange(false);
  };

  const act = async (fn: (id: string) => Promise<Result>) => {
    if (!operator) return;
    const r = await fn(operator.id);
    if (!r.ok) return setError(r.error);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{operator ? "Editar operario" : "Nuevo operario"}</DialogTitle>
          <DialogDescription>
            El costo por hora se usa para valorizar las horas que cargue. Un cambio vale desde la fecha que indiques: las horas anteriores conservan su
            valor.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field label="Nombre" htmlFor="op-name"><Input id="op-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Rol o especialidad" htmlFor="op-role"><Input id="op-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Carpintería, Armado…" /></Field>
          <Field label="Costo por hora ($)" htmlFor="op-rate"><Input id="op-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          {operator && parseDecimal(rate) !== operator.hourlyCost && (
            <Field label="El nuevo costo vale desde" htmlFor="op-valid-from" hint="Por defecto, hoy. Las horas cargadas antes de esa fecha no cambian.">
              <Input id="op-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
          )}
          {operator && <PriceHistoryList kind="operator_cost" subjectId={operator.id} label={`costo por hora de ${operator.name}`} />}
          <Field
            label="Email (opcional)"
            htmlFor="op-email"
            hint="Es un dato de la persona. Para que entre a Blerp como Operario, invitalo desde Configuración → Usuarios (puede existir sin usuario)."
          >
            <Input id="op-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {operator && (
            <section aria-label="Alta y baja" className="space-y-3 rounded-lg border border-slate-200 p-3">
              {operator.active ? (
                confirm === "deactivate" ? (
                  <DeactivatePanel operator={operator} onCancel={() => setConfirm(null)} onDone={() => onOpenChange(false)} />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-slate-600">Si ya no trabaja con ustedes, dalo de baja. No se borra nada.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setConfirm("deactivate")}>
                      <UserMinus /> Dar de baja
                    </Button>
                  </div>
                )
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-slate-600">
                    Dado de baja{operator.deactivatedAt ? ` el ${formatDate(operator.deactivatedAt)}` : ""}.
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => act(reactivateOperator)}>
                    <UserCheck /> Reactivar
                  </Button>
                </div>
              )}
              <div className="border-t border-slate-100 pt-3 text-sm">
                {hasRecords ? (
                  <p className="text-slate-500">Tiene horas registradas: no se puede eliminar definitivamente, solo dar de baja.</p>
                ) : confirm === "delete" ? (
                  <div className="space-y-2">
                    <p className="text-slate-800">
                      ¿Eliminar definitivamente a <strong>{operator.name}</strong>? No tiene horas registradas. Esto no se puede deshacer.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>No, volver</Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => act(deleteOperator)}>Sí, eliminar</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-500">No tiene horas registradas.</span>
                    <Button type="button" variant="ghost" size="sm" className="text-red-700" onClick={() => setConfirm("delete")}>
                      <Trash2 /> Eliminar definitivamente
                    </Button>
                  </div>
                )}
              </div>
            </section>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit">Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OperatorsPage({ op }: { op?: string }) {
  const operators = useAppStore((s) => s.operators);
  const projects = useAppStore((s) => s.projects);
  const reactivateOperator = useConfirmedAction("reactivateOperator");
  const { isManager } = useIdentity();
  const [editing, setEditing] = useState<Operator | null | "new">(op ? (operators.find((o) => o.id === op) ?? null) : null);
  const [showDeactivated, setShowDeactivated] = useState(false);
  const shown = visibleOperators(operators, showDeactivated);
  const deactivatedCount = operators.length - activeOperators(operators).length;

  const stats = useMemo(() => {
    const m = new Map<string, { hours: number; cost: number; projects: number }>();
    for (const o of operators) m.set(o.id, { hours: 0, cost: 0, projects: projects.filter((p) => !p.isClosed && p.assignedOperatorIds.includes(o.id)).length });
    for (const p of projects)
      for (const e of p.actualEntries) {
        if (e.type !== "labor" || !e.operatorId) continue;
        const s = m.get(e.operatorId);
        if (s) { s.hours += e.labor?.hours ?? 0; s.cost += e.amount; }
      }
    return m;
  }, [operators, projects]);

  return (
    <div>
      <PageHeader
        back
        title="Operarios"
        subtitle="Quién trabaja, a qué costo por hora y en qué proyectos. Las horas se cargan siempre a nombre de un operario."
        actions={isManager ? <Button onClick={() => setEditing("new")}><Plus /> Nuevo operario</Button> : undefined}
      />
      {operators.length > 0 && (
        <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="size-4" checked={showDeactivated} onChange={(e) => setShowDeactivated(e.target.checked)} />
          Mostrar dados de baja <span className="text-slate-400 tabular">({deactivatedCount})</span>
        </label>
      )}
      {operators.length === 0 ? (
        <EmptyState icon={HardHat} title="Todavía no hay operarios" description="Cargá a las personas que registran horas en el taller." />
      ) : shown.length === 0 ? (
        <EmptyState icon={HardHat} title="No hay operarios activos" description="Marcá “Mostrar dados de baja” para ver a los que están de baja y reactivarlos." />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Rol</TH>
                <TH className="text-right">Costo por hora</TH>
                <TH className="text-right">Proyectos activos</TH>
                <TH className="text-right">Horas cargadas</TH>
                <TH>Acceso</TH>
                <TH>Situación</TH>
                <TH><span className="sr-only">Acciones</span></TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((o) => {
                const s = stats.get(o.id);
                return (
                  <TR key={o.id} className={o.id === op ? "bg-amber-50" : undefined}>
                    <TD className="font-medium text-slate-900">{o.name}</TD>
                    <TD>{o.role}</TD>
                    <TD className="text-right tabular">{formatCurrency(o.hourlyCost)}</TD>
                    <TD className="text-right tabular">{s?.projects ?? 0}</TD>
                    <TD className="text-right tabular">{formatNumber(s?.hours ?? 0)} h · {formatCurrency(s?.cost ?? 0)}</TD>
                    <TD className="text-xs text-slate-600">{o.userId ? "Vinculado" : o.email ? `Invitado: ${o.email}` : "Sin acceso"}</TD>
                    <TD>
                      <Badge tone={o.active ? "green" : "gray"}>
                        {o.active ? "Activo" : `Dado de baja${o.deactivatedAt ? ` el ${formatDate(o.deactivatedAt)}` : ""}`}
                      </Badge>
                    </TD>
                    <TD>
                      {isManager && (
                        <div className="flex justify-end gap-2">
                          {!o.active && (
                            <Button size="sm" variant="outline" onClick={async () => await reactivateOperator(o.id)}>
                              <UserCheck /> Reactivar
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setEditing(o)}>Editar</Button>
                        </div>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
      {editing !== null && (
        <OperatorDialog
          key={editing === "new" ? "new" : editing.id}
          operator={editing === "new" ? null : editing}
          hasRecords={editing !== "new" && operatorHasRecords(projects, editing.id)}
          open
          onOpenChange={(o) => { if (!o) setEditing(null); }}
        />
      )}
    </div>
  );
}
