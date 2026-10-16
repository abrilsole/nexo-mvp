"use client";
import { useMemo, useState } from "react";
import { Package } from "lucide-react";
import type { Project } from "@/types";
import { SOURCE_LABELS, UNIT_COST_ORIGIN_LABELS } from "@/lib/constants";
import { materialRows, type MaterialRow } from "@/lib/material-reconciliation";
import { materialInsights } from "@/lib/insights";
import { usageProjectCost } from "@/lib/calculations";
import { projectMaterialPosition } from "@/lib/material-flow";
import { canExecute } from "@/lib/project-rules";
import { movementSentence, MOVEMENT_LABELS } from "@/lib/stock-labels";
import { useAppStore } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { MaterialFlowCards } from "./material-flow-cards";
import { MaterialCostsCard } from "./material-costs-card";
import { PurchaseForm } from "./purchase-form";
import { StockActionDialog, type StockAction, type StockTarget } from "@/components/stock/stock-action-dialog";
import { formatCurrency, formatDate, formatNumber, formatQty, formatSignedCurrency } from "@/lib/formatting";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { InsightList } from "@/components/shared/insight-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const q = (n: number) => (n === 0 ? <span className="text-slate-300">0</span> : formatNumber(n));

export function MaterialsTable({ rows }: { rows: MaterialRow[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Material</TH>
          <TH className="text-right">Presupuestado</TH>
          <TH className="text-right">Comprado / asignado</TH>
          <TH className="text-right">Consumido</TH>
          <TH className="text-right">Desperdicio</TH>
          <TH className="text-right">Sobrante reutilizable</TH>
          <TH className="text-right">Costo presupuestado</TH>
          <TH className="text-right">Costo imputado real</TH>
          <TH className="text-right">Desvío</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.key}>
            <TD className="min-w-48">
              <div className="font-medium text-slate-900">{r.name}</div>
              <div className="text-xs text-slate-500">
                {r.unit}
                {r.fromStockQty > 0 && ` · ${formatNumber(r.fromStockQty)} de stock existente`}
              </div>
            </TD>
            <TD className="text-right tabular">{q(r.budgetQty)}</TD>
            <TD className="text-right tabular">{q(r.purchasedQty)}</TD>
            <TD className="text-right tabular">{q(r.consumedQty)}</TD>
            <TD className="text-right tabular">{q(r.wasteQty)}</TD>
            <TD className="text-right tabular">{q(r.leftoverQty)}</TD>
            <TD className="text-right tabular">{formatCurrency(r.budgetCost)}</TD>
            <TD className="text-right font-medium tabular text-slate-900">{formatCurrency(r.imputedCost)}</TD>
            <TD className={`text-right tabular whitespace-nowrap ${r.variance > 0 ? "font-medium text-red-700" : r.variance < 0 ? "text-slate-500" : "text-slate-400"}`}>
              {r.variance === 0 ? "—" : formatSignedCurrency(r.variance)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}


const Q = ({ n }: { n: number }) => (n === 0 ? <span className="text-slate-300">0</span> : <>{formatNumber(n)}</>);

function PositionCard({ project, canManage }: { project: Project; canManage: boolean }) {
  const stock = useAppStore((s) => s.stock);
  const rows = useMemo(() => projectMaterialPosition(project, stock), [project, stock]);
  const [act, setAct] = useState<{ action: StockAction; target: StockTarget } | null>(null);
  const [buy, setBuy] = useState<{ materialId: string; quantity: number } | null>(null);
  const toTarget = (r: (typeof rows)[number], max: number, from: boolean): StockTarget => ({
    materialId: r.key,
    materialName: r.name,
    unit: r.unit,
    max,
    ...(from ? { fromProjectId: project.id } : { toProjectId: project.id }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Requerido vs. asignado a este proyecto</CardTitle>
        <CardDescription>
          Un operario sólo puede consumir lo <strong>asignado</strong> a este proyecto. Lo que falta se cubre con stock existente o con una compra.
        </CardDescription>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent><p className="text-sm text-slate-500">El costo presupuestado no tiene materiales con cantidad.</p></CardContent>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Material</TH>
              <TH className="text-right">Requerido</TH>
              <TH className="text-right">Disponible (libre en depósito)</TH>
              <TH className="text-right">Asignado a este proyecto</TH>
              <TH className="text-right">Usado</TH>
              <TH className="text-right">Falta</TH>
              {canManage && <TH>Acciones</TH>}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.key}>
                <TD className="min-w-44">
                  <div className="font-medium text-slate-900">{r.name}</div>
                  <div className="text-xs text-slate-500">{r.unit}</div>
                </TD>
                <TD className="text-right tabular"><Q n={r.required} /></TD>
                <TD className="text-right tabular"><Q n={r.availableInStock} /></TD>
                <TD className="text-right tabular font-medium text-slate-900"><Q n={r.assigned} /></TD>
                <TD className="text-right tabular"><Q n={r.consumed + r.wasted} /></TD>
                <TD className={`text-right tabular ${r.missing > 0 ? "font-medium text-amber-700" : "text-slate-300"}`}>{r.missing > 0 ? formatNumber(r.missing) : "0"}</TD>
                {canManage && (
                  <TD>
                    <div className="flex flex-wrap gap-1.5">
                      {r.availableInStock > 0 && r.missing > 0 && (
                        <Button size="sm" variant="outline" onClick={() => setAct({ action: "assign", target: toTarget(r, Math.min(r.availableInStock, r.missing), false) })}>
                          Asignar de stock
                        </Button>
                      )}
                      {r.missing > 0 && (
                        <Button size="sm" variant="outline" onClick={() => setBuy({ materialId: r.key, quantity: r.missing })}>
                          Comprar faltante
                        </Button>
                      )}
                      {r.assigned > 0 && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setAct({ action: "release", target: toTarget(r, r.assigned, true) })}>Devolver</Button>
                          <Button size="sm" variant="ghost" onClick={() => setAct({ action: "transfer", target: toTarget(r, r.assigned, true) })}>Transferir</Button>
                          <Button size="sm" variant="ghost" onClick={() => setAct({ action: "leftover", target: toTarget(r, r.assigned, true) })}>Sobrante</Button>
                          <Button size="sm" variant="ghost" onClick={() => setAct({ action: "supplier", target: toTarget(r, r.assigned, true) })}>A proveedor</Button>
                        </>
                      )}
                    </div>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {act && (
        <StockActionDialog action={act.action} target={act.target} open onOpenChange={(o) => { if (!o) setAct(null); }} />
      )}
      <Dialog open={buy !== null} onOpenChange={(o) => { if (!o) setBuy(null); }}>
        <DialogContent side="right">
          <DialogHeader>
            <DialogTitle>Comprar faltante</DialogTitle>
            <DialogDescription>Queda asignado a este proyecto. No es costo hasta que se consuma.</DialogDescription>
          </DialogHeader>
          {buy && <PurchaseForm project={project} prefill={buy} onDone={() => setBuy(null)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function MaterialsTab({
  project,
  showCosts = true,
  highlightPurchaseId,
}: {
  project: Project;
  showCosts?: boolean;
  highlightPurchaseId?: string;
}) {
  const stock = useAppStore((s) => s.stock);
  const projects = useAppStore((s) => s.projects);
  const { isManager } = useIdentity();
  const canManage = isManager && !project.isClosed && canExecute(project.status);
  const rows = useMemo(() => materialRows(project), [project]);
  const insights = useMemo(() => materialInsights(project, stock), [project, stock]);
  const usages = [...project.materialUsages].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const purchases = [...project.purchaseEntries].sort((a, b) => b.date.localeCompare(a.date));
  const lotById = useMemo(() => new Map(stock.lots.map((l) => [l.id, l])), [stock.lots]);
  const movements = useMemo(
    () =>
      stock.movements
        .filter((m) => (m.from.type === "project" && m.from.projectId === project.id) || (m.to.type === "project" && m.to.projectId === project.id))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [stock.movements, project.id],
  );

  if (rows.length === 0 && movements.length === 0) {
    return <EmptyState icon={Package} title="Todavía no hay materiales" description="Agregá materiales al costo presupuestado o registrá una compra o un consumo." />;
  }

  return (
    <div className="space-y-6">
      {showCosts && <MaterialCostsCard project={project} />}
      <MaterialFlowCards project={project} />
      <PositionCard project={project} canManage={canManage} />

      <Card>
        <CardHeader>
          <CardTitle>Presupuestado vs. costo imputado</CardTitle>
          <CardDescription>
            El costo imputado = consumo + desperdicio. Lo comprado y el sobrante reutilizable <strong>no</strong> se imputan al proyecto.
          </CardDescription>
        </CardHeader>
        <MaterialsTable rows={rows} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qué dicen los materiales</CardTitle>
        </CardHeader>
        <CardContent className="md:columns-2 md:gap-8 [&_li]:break-inside-avoid">
          <InsightList insights={insights} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Registros de uso</CardTitle>
            <CardDescription>Cada registro muestra de qué lote salió y cómo se valorizó.</CardDescription>
          </CardHeader>
          {usages.length === 0 ? (
            <CardContent><p className="text-sm text-slate-500">Sin consumos registrados.</p></CardContent>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Material</TH>
                  <TH>Registro</TH>
                  {showCosts && <TH className="text-right">Imputado</TH>}
                </TR>
              </THead>
              <TBody>
                {usages.map((u) => {
                  const item = u.itemId ? project.items.find((i) => i.id === u.itemId) : undefined;
                  return (
                    <TR key={u.id}>
                      <TD className="whitespace-nowrap tabular">{formatDate(u.date)}</TD>
                      <TD>
                        <div className="font-medium text-slate-900">{u.materialName}</div>
                        <div className="text-xs text-slate-500">{SOURCE_LABELS[u.source]} · {u.createdBy}{item ? ` · ${item.name}` : ""}</div>
                      </TD>
                      <TD className="text-xs text-slate-600">
                        {formatQty(u.quantityConsumed, u.unit)} consumido
                        {u.wasteQuantity > 0 && ` · ${formatNumber(u.wasteQuantity)} desperdicio`}
                        {u.reusableLeftoverQuantity > 0 && ` · ${formatNumber(u.reusableLeftoverQuantity)} sobrante`}
                        {showCosts && (
                          <div className="text-slate-400">
                            {formatCurrency(u.unitCost)}/{u.unit} · {UNIT_COST_ORIGIN_LABELS[u.unitCostOrigin]}
                          </div>
                        )}
                      </TD>
                      {showCosts && <TD className="whitespace-nowrap text-right font-medium tabular">{formatCurrency(usageProjectCost(u))}</TD>}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Compras registradas</CardTitle>
            <CardDescription>Registrar una compra no imputa costo: se imputa lo que se consume o desperdicia.</CardDescription>
          </CardHeader>
          {purchases.length === 0 ? (
            <CardContent><p className="text-sm text-slate-500">Sin compras registradas.</p></CardContent>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Material</TH>
                  <TH className="text-right">Cantidad</TH>
                  <TH className="text-right">Total compra</TH>
                </TR>
              </THead>
              <TBody>
                {purchases.map((p) => (
                  <TR key={p.id} id={`purchase-${p.id}`} className={p.id === highlightPurchaseId ? "bg-amber-50" : undefined}>
                    <TD className="whitespace-nowrap tabular">{formatDate(p.date)}</TD>
                    <TD>
                      <div className="font-medium text-slate-900">{p.materialName}</div>
                      <div className="text-xs text-slate-500">{p.supplier ?? "Sin proveedor"} · {p.createdBy}</div>
                    </TD>
                    <TD className="text-right tabular whitespace-nowrap">{formatQty(p.quantity, p.unit)}</TD>
                    <TD className="whitespace-nowrap text-right tabular">{formatCurrency(p.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historial del material</CardTitle>
          <CardDescription>Comprado para A → transferido a B → consumido en B. Cada movimiento queda registrado.</CardDescription>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-slate-500">Sin movimientos de stock.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {movements.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="w-24 shrink-0 tabular text-xs text-slate-500">{formatDate(m.date)}</span>
                  <Badge tone="gray">{MOVEMENT_LABELS[m.kind]}</Badge>
                  <span className="min-w-0 flex-1 text-slate-700">{movementSentence(m, lotById.get(m.lotId), projects)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
