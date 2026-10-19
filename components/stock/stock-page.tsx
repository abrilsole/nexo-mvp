"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Plus } from "lucide-react";
import type { StockLot } from "@/types";
import { computeBalances, leftoverRows, lotTrail, stockRows, stockTotalValue, EPS } from "@/lib/stock";
import { formatDims } from "@/lib/material-kinds";
import { movementSentence, MOVEMENT_LABELS, projectCode } from "@/lib/stock-labels";
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatQty } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { projectHref } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StockActionDialog, type StockAction, type StockTarget } from "./stock-action-dialog";
import { AddStockDialog } from "./add-stock-dialog";

type Act = { action: StockAction; target: StockTarget };

function LotTrailDialog({ lotId, onClose }: { lotId: string | null; onClose: () => void }) {
  const stock = useAppStore((s) => s.stock);
  const projects = useAppStore((s) => s.projects);
  const lot = stock.lots.find((l) => l.id === lotId);
  const lots = useMemo(() => new Map(stock.lots.map((l) => [l.id, l])), [stock.lots]);
  const trail = useMemo(() => (lotId ? lotTrail(stock, lotId) : []), [stock, lotId]);
  return (
    <Dialog open={lotId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent side="right">
        <DialogHeader>
          <DialogTitle>Recorrido del material</DialogTitle>
          <DialogDescription>
            {lot ? `${lot.materialName} · ${formatCurrency(lot.unitCost)}/${lot.unit}` : "Lote no encontrado"}
            {lot?.originProjectName ? ` · origen: ${lot.originProjectName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {trail.map((m) => (
            <li key={m.id} className="border-l-2 border-slate-200 pl-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone="gray">{MOVEMENT_LABELS[m.kind]}</Badge>
                <span className="text-xs text-slate-500 tabular">{formatDate(m.date)}</span>
              </div>
              <p className="mt-1 text-slate-700">{movementSentence(m, lots.get(m.lotId), projects)}</p>
              {m.note && <p className="text-xs text-slate-500">{m.note}</p>}
            </li>
          ))}
          {trail.length === 0 && <p className="text-sm text-slate-500">Sin movimientos.</p>}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function lotLabel(l: StockLot) {
  const d = formatDims(l.dims);
  return `${l.kind === "leftover" ? "Sobrante" : l.kind === "opening" ? "Inventario inicial" : "Compra"}${d ? ` · ${d}` : ""}`;
}

/** El mismo módulo para Administrativo (/stock, lo edita) y Compras (/compras/stock, solo consulta). */
export function StockPage({ material, lot, tab, basePath = "/stock" }: { material?: string; lot?: string; tab?: string; basePath?: string }) {
  const stock = useAppStore((s) => s.stock);
  const projects = useAppStore((s) => s.projects);
  const requests = useAppStore((s) => s.requests);
  const setRequestStatus = useConfirmedAction("setRequestStatus");
  const updateLotLocation = useConfirmedAction("updateLotLocation");
  // Compras ve el stock en modo solo consulta (también en la base): solo el Administrativo lo edita.
  const { isManager: canManage, roleKey } = useIdentity();
  const projectLink = (id: string, tabName?: string) => projectHref(roleKey, id, tabName);
  const [query, setQuery] = useState("");
  const [add, setAdd] = useState(false);
  const [act, setAct] = useState<Act | null>(null);
  const [trailLot, setTrailLot] = useState<string | null>(lot ?? null);
  const [expanded, setExpanded] = useState<string | null>(material ?? null);

  const rows = useMemo(() => stockRows(stock), [stock]);
  const leftovers = useMemo(() => leftoverRows(stock), [stock]);
  const balances = useMemo(() => computeBalances(stock.movements), [stock.movements]);
  const total = stockTotalValue(stock);
  const filtered = rows.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  const openRequests = requests.filter((r) => r.status === "open");
  const defaultTab = tab === "sobrantes" || tab === "pedidos" ? tab : lot && leftovers.some((l) => l.lot.id === lot) ? "sobrantes" : "materiales";

  const lotsOf = (key: string) =>
    stock.lots
      .filter((l) => l.materialId === key)
      .map((l) => ({ lot: l, bal: balances.get(l.id) }))
      .filter((x) => x.bal && x.bal.warehouse + Object.values(x.bal.held).reduce((s, q) => s + q, 0) > EPS);

  const editLocation = async (l: StockLot) => {
    const next = window.prompt("Ubicación del material", l.location ?? "");
    if (next !== null) await updateLotLocation(l.id, next.trim());
  };

  return (
    <div>
      <PageHeader
        back={material || lot || tab ? basePath : undefined}
        title="Stock"
        subtitle="Todo el material físico: libre en el depósito y asignado a proyectos. Cada lote conserva su costo original."
        actions={canManage ? <Button onClick={() => setAdd(true)}><Plus /> Ingresar stock</Button> : undefined}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Valor total en stock</div><div className="text-lg font-semibold tabular">{formatCurrency(total)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Materiales</div><div className="text-lg font-semibold tabular">{rows.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Sobrantes reutilizables</div><div className="text-lg font-semibold tabular">{leftovers.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Pedidos de operarios abiertos</div><div className="text-lg font-semibold tabular">{openRequests.length}</div></CardContent></Card>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="materiales">Materiales</TabsTrigger>
          <TabsTrigger value="sobrantes">Sobrantes ({leftovers.length})</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos de operarios ({openRequests.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="materiales">
          <div className="mb-3 max-w-sm">
            <label htmlFor="stock-q" className="sr-only">Buscar material</label>
            <Input id="stock-q" placeholder="Buscar material…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon={Boxes} title="No hay stock para mostrar" description="Registrá una compra para el depósito o desde la etapa Compras de un proyecto." />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Material</TH>
                    <TH className="text-right">Físico</TH>
                    <TH className="text-right">Disponible</TH>
                    <TH className="text-right">Asignado a proyectos</TH>
                    <TH className="text-right">Costo unit.</TH>
                    <TH className="text-right">Valor</TH>
                    <TH className="text-right">Sobrantes</TH>
                    <TH>Ubicación</TH>
                    <TH><span className="sr-only">Detalle</span></TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((r) => (
                    <Fragment key={r.key}>
                      <TR className={r.key === material ? "bg-amber-50" : undefined}>
                        <TD className="min-w-44 font-medium text-slate-900">{r.name}<div className="text-xs font-normal text-slate-500">{r.unit}</div></TD>
                        <TD className="text-right tabular">{formatNumber(r.physical)}</TD>
                        <TD className="text-right tabular font-medium">{formatNumber(r.available)}</TD>
                        <TD className="text-right tabular">{formatNumber(r.assigned)}</TD>
                        <TD className="text-right tabular">{formatCurrency(r.unitCost)}</TD>
                        <TD className="text-right tabular">{formatCurrency(r.value)}</TD>
                        <TD className="text-right tabular">{r.leftoverQty > 0 ? formatNumber(r.leftoverQty) : <span className="text-slate-300">0</span>}</TD>
                        <TD className="text-xs text-slate-600">{r.locations.join(", ") || "—"}</TD>
                        <TD>
                          <Button size="sm" variant="ghost" aria-expanded={expanded === r.key} onClick={() => setExpanded(expanded === r.key ? null : r.key)}>
                            {expanded === r.key ? "Ocultar" : "Ver lotes"}
                          </Button>
                        </TD>
                      </TR>
                      {expanded === r.key && (
                        <TR>
                          <TD colSpan={9} className="bg-slate-50/60">
                            <div className="space-y-3 py-1">
                              {r.byProject.length > 0 && (
                                <p className="text-xs text-slate-600">
                                  Asignado a:{" "}
                                  {r.byProject.map((b, i) => (
                                    <span key={b.projectId}>
                                      {i > 0 && " · "}
                                      <Link className="text-blue-700 hover:underline" href={projectLink(b.projectId, "materials")}>
                                        {projectCode(projects, b.projectId)}
                                      </Link>{" "}
                                      {formatQty(b.quantity, r.unit)}
                                    </span>
                                  ))}
                                </p>
                              )}
                              <ul className="divide-y divide-slate-200">
                                {lotsOf(r.key).map(({ lot: l, bal }) => (
                                  <li key={l.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm ${l.id === lot ? "bg-amber-50" : ""}`}>
                                    <span className="min-w-40 font-medium text-slate-800">{lotLabel(l)}</span>
                                    <span className="text-slate-600">{formatCurrency(l.unitCost)}/{l.unit}</span>
                                    <span className="text-slate-600">Libre: {formatQty(bal?.warehouse ?? 0, l.unit)}</span>
                                    <span className="text-xs text-slate-500">
                                      {l.originProjectName ? `Origen: ${l.originProjectName}` : l.supplier ? `Proveedor: ${l.supplier}` : ""}
                                      {l.location ? ` · ${l.location}` : ""}
                                    </span>
                                    <span className="ml-auto flex gap-1.5">
                                      <Button size="sm" variant="outline" onClick={() => setTrailLot(l.id)}>Recorrido</Button>
                                      {canManage && (
                                        <>
                                          <Button size="sm" variant="ghost" onClick={() => editLocation(l)}>Ubicación</Button>
                                          {(bal?.warehouse ?? 0) > EPS && (
                                            <Button
                                              size="sm"
                                              onClick={() =>
                                                setAct({
                                                  action: "assign",
                                                  target: { materialId: l.materialId, materialName: l.materialName, unit: l.unit, max: bal?.warehouse ?? 0, lotId: l.id, lotLabel: lotLabel(l) },
                                                })
                                              }
                                            >
                                              Asignar a proyecto
                                            </Button>
                                          )}
                                        </>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </TD>
                        </TR>
                      )}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="sobrantes">
          {leftovers.length === 0 ? (
            <EmptyState icon={Boxes} title="No hay sobrantes reutilizables" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Sobrantes reutilizables</CardTitle>
                <CardDescription>Conservan el costo del proyecto de origen. No son desperdicio.</CardDescription>
              </CardHeader>
              <Table>
                <THead>
                  <TR>
                    <TH>Material</TH>
                    <TH>Medidas</TH>
                    <TH className="text-right">Cantidad</TH>
                    <TH className="text-right">Valor</TH>
                    <TH>Origen</TH>
                    <TH>Estado</TH>
                    <TH><span className="sr-only">Acciones</span></TH>
                  </TR>
                </THead>
                <TBody>
                  {leftovers.map((l) => (
                    <TR key={`${l.lot.id}-${l.assignedProjectId ?? "w"}`} className={l.lot.id === lot ? "bg-amber-50" : undefined}>
                      <TD className="font-medium text-slate-900">{l.lot.materialName}</TD>
                      <TD className="text-xs text-slate-600">{formatDims(l.lot.dims) || "—"}</TD>
                      <TD className="text-right tabular">{formatQty(l.quantity, l.lot.unit)}</TD>
                      <TD className="text-right tabular">{formatCurrency(l.quantity * l.lot.unitCost)}</TD>
                      <TD className="text-xs">
                        {l.lot.originProjectId ? (
                          <Link href={projectLink(l.lot.originProjectId)} className="text-blue-700 hover:underline">{l.lot.originProjectName}</Link>
                        ) : "—"}
                      </TD>
                      <TD className="text-xs text-slate-600">
                        {l.assignedProjectId ? `Asignado a ${projectCode(projects, l.assignedProjectId)}` : `Libre${l.lot.location ? ` · ${l.lot.location}` : ""}`}
                      </TD>
                      <TD>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setTrailLot(l.lot.id)}>Recorrido</Button>
                          {canManage && !l.assignedProjectId && (
                            <Button
                              size="sm"
                              onClick={() =>
                                setAct({
                                  action: "assign",
                                  target: { materialId: l.lot.materialId, materialName: l.lot.materialName, unit: l.lot.unit, max: l.quantity, lotId: l.lot.id, lotLabel: lotLabel(l.lot) },
                                })
                              }
                            >
                              Asignar
                            </Button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pedidos">
          {requests.length === 0 ? (
            <EmptyState icon={Boxes} title="Sin pedidos de operarios" description="Cuando un operario solicite material, aparece acá." />
          ) : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Proyecto</TH>
                    <TH>Material</TH>
                    <TH className="text-right">Cantidad</TH>
                    <TH>Pidió</TH>
                    <TH>Estado</TH>
                    <TH><span className="sr-only">Acciones</span></TH>
                  </TR>
                </THead>
                <TBody>
                  {[...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap tabular">{formatDateTime(r.createdAt)}</TD>
                      <TD><Link className="text-blue-700 hover:underline" href={projectLink(r.projectId, "materials")}>{projectCode(projects, r.projectId)}</Link></TD>
                      <TD>{r.materialName}{r.note && <div className="text-xs text-slate-500">{r.note}</div>}</TD>
                      <TD className="text-right tabular">{formatQty(r.quantity, r.unit)}</TD>
                      <TD>{r.requestedBy}</TD>
                      <TD><Badge tone={r.status === "open" ? "yellow" : r.status === "resolved" ? "green" : "gray"}>{r.status === "open" ? "Abierto" : r.status === "resolved" ? "Resuelto" : "Cancelado"}</Badge></TD>
                      <TD>
                        {canManage && r.status === "open" && (
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="outline" onClick={async () => await setRequestStatus(r.id, "resolved")}>Resuelto</Button>
                            <Button size="sm" variant="ghost" onClick={async () => await setRequestStatus(r.id, "cancelled")}>Cancelar</Button>
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <AddStockDialog open={add} onOpenChange={setAdd} />
      {act && <StockActionDialog action={act.action} target={act.target} open onOpenChange={(o) => { if (!o) setAct(null); }} />}
      <LotTrailDialog lotId={trailLot} onClose={() => setTrailLot(null)} />
    </div>
  );
}
