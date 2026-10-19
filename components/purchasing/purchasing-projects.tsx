"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
// Compras → Necesidades (Lote 6): los materiales de los proyectos aprobados con lo que falta pedir, neteando el stock
// libre del depósito. Estado por material: Por comprar / En orden de compra / Recibido (se deriva de las órdenes).
// Se eligen varios ítems (de uno o varios proyectos) y se genera una orden de compra. Sin precio de venta ni mano de obra.
import Link from "next/link";
import { useMemo, useState } from "react";
import { ClipboardList, FileText } from "lucide-react";
import { formatCurrency, formatDate, formatNumber, formatQty, todayISO } from "@/lib/formatting";
import { MATERIALS_STATE_LABELS, materialsState, NEED_STATUS_LABELS, purchaseHistory, supplierPrices, type MaterialNeed, type MaterialsState, type NeedStatus } from "@/lib/purchasing";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { useMaterialNeeds } from "@/store/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Choice } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const NEED_TONE: Record<NeedStatus, "yellow" | "blue" | "green"> = { to_buy: "yellow", ordered: "blue", received: "green" };
const STATE_TONE: Record<MaterialsState, "gray" | "blue" | "green"> = { none: "gray", on_the_way: "blue", complete: "green" };

export function NeedPill({ status }: { status: NeedStatus }) {
  return <Badge tone={NEED_TONE[status]}>{NEED_STATUS_LABELS[status]}</Badge>;
}

/** Estado de materiales del proyecto (Sin comprar / En camino / Completo). Lo ven también el Administrativo y el Jefe de planta. */
export function MaterialsBadge({ state }: { state: MaterialsState | null }) {
  if (!state) return null;
  return <Badge tone={STATE_TONE[state]}>Materiales: {MATERIALS_STATE_LABELS[state]}</Badge>;
}

type Filter = "to_buy" | "all";

export function PurchasingProjectsPage({ projectId }: { projectId?: string }) {
  const projects = useAppStore((s) => s.projects);
  const needs = useMaterialNeeds();
  const [filter, setFilter] = useState<Filter>("to_buy");
  const [selected, setSelected] = useState<string[]>([]);
  const [ordering, setOrdering] = useState<MaterialNeed[] | null>(null);
  const keyOf = (n: MaterialNeed) => `${n.projectId}|${n.lineId}`;
  const visible = needs.filter((n) => (filter === "all" || n.toBuy > 0) && (!projectId || n.projectId === projectId));
  const groups = [...new Set(visible.map((n) => n.projectId))];
  const chosen = needs.filter((n) => selected.includes(keyOf(n)));
  const toggle = (n: MaterialNeed) => setSelected(selected.includes(keyOf(n)) ? selected.filter((k) => k !== keyOf(n)) : [...selected, keyOf(n)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Necesidades"
        subtitle="Materiales de los proyectos aprobados: lo que falta pedir (descontando el stock libre del depósito), lo que está en órdenes y lo recibido."
        actions={
          <Button disabled={chosen.length === 0} onClick={() => setOrdering(chosen)}>
            <FileText /> Generar orden de compra{chosen.length > 0 ? ` (${chosen.length})` : ""}
          </Button>
        }
      />
      <div className="max-w-sm">
        <Choice<Filter>
          name="Qué materiales ver"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "to_buy", label: "Por comprar" },
            { value: "all", label: "Todos" },
          ]}
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No hay materiales por comprar" description="Cuando se apruebe un proyecto, sus materiales aparecen acá." />
      ) : (
        groups.map((pid) => {
          const p = projects.find((x) => x.id === pid);
          const mine = visible.filter((n) => n.projectId === pid);
          return (
            <Card key={pid}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-500">{p?.code}</span> {p?.name} <MaterialsBadge state={materialsState(needs, pid)} />
                </CardTitle>
                <p className="text-sm text-slate-500">Inicio {p ? formatDate(p.startDate) : ""}: los materiales se necesitan para ese día.</p>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-slate-100">
                  {mine.map((n) => (
                    <li key={keyOf(n)} className="flex gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        aria-label={`Elegir ${n.description} de ${n.projectCode}`}
                        disabled={n.toBuy <= 0}
                        checked={selected.includes(keyOf(n))}
                        onChange={() => toggle(n)}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-words font-medium text-slate-900">{n.description}</span>
                          <NeedPill status={n.status} />
                        </div>
                        <p className="text-slate-600">
                          Necesario {formatQty(n.needed, n.unit)} · costo unitario estimado {formatCurrency(n.estimatedUnitCost)}
                          <span className="text-xs text-slate-400"> (estimado, de memoria)</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          {n.ordered > 0 && `En órdenes ${formatQty(n.ordered, n.unit)} (${n.orders.map((o) => o.number).join(", ")}) · recibido ${formatQty(n.receivedFromOrders, n.unit)} · `}
                          {n.direct > 0 && `Compras directas ${formatQty(n.direct, n.unit)} · `}
                          {n.fromDepot > 0 && `Asignado del depósito ${formatQty(n.fromDepot, n.unit)} · `}
                          {n.fromStock > 0 && (
                            <span className="text-emerald-700">
                              En el depósito hay {formatQty(n.fromStock, n.unit)} libres para este proyecto (el Administrativo los asigna desde Stock) ·{" "}
                            </span>
                          )}
                          <strong className={cn(n.toBuy > 0 ? "text-amber-800" : "text-slate-600")}>Falta pedir {formatQty(n.toBuy, n.unit)}</strong>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
      <OrderDialog needs={ordering} onClose={() => setOrdering(null)} onDone={() => setSelected([])} />
    </div>
  );
}

/** Generar una orden de compra con los ítems elegidos: proveedor, fecha y el costo unitario REAL conseguido. */
function OrderDialog({ needs, onClose, onDone }: { needs: MaterialNeed[] | null; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={needs !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">{needs && <OrderForm key={needs.map((n) => n.lineId).join(",")} needs={needs} onClose={onClose} onDone={onDone} />}</DialogContent>
    </Dialog>
  );
}

function OrderForm({ needs, onClose, onDone }: { needs: MaterialNeed[]; onClose: () => void; onDone: () => void }) {
  const projects = useAppStore((s) => s.projects);
  const stock = useAppStore((s) => s.stock);
  const saveOrder = useConfirmedAction("saveOrder");
  const prices = useMemo(() => supplierPrices(purchaseHistory(projects, stock)), [projects, stock]);
  const suggested = prices.find((m) => m.key === needs[0]?.key)?.suppliers[0]?.supplier ?? "";
  const [supplier, setSupplier] = useState(suggested);
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState(() => needs.map((n) => ({ qty: String(n.toBuy).replace(".", ","), cost: String(n.estimatedUnitCost).replace(".", ",") })));
  const [error, setError] = useState("");
  const total = needs.reduce((s, _, i) => s + (parseDecimal(rows[i].qty) || 0) * (parseDecimal(rows[i].cost) || 0), 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await saveOrder({
      supplier,
      date,
      notes,
      lines: needs.map((n, i) => ({
        projectId: n.projectId,
        budgetLineId: n.lineId,
        materialId: n.materialId,
        materialName: n.description,
        unit: n.unit,
        quantity: parseDecimal(rows[i].qty),
        unitCost: parseDecimal(rows[i].cost),
      })),
    });
    if (!r.ok) return setError(r.error);
    onDone();
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nueva orden de compra</DialogTitle>
        <DialogDescription>
          Queda en Borrador con el próximo número. El costo unitario es el REAL que conseguiste (la negociación queda afuera del sistema): el costo real
          del proyecto cambia recién al registrar la factura.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={save} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Proveedor elegido" htmlFor="oc-supplier">
            <Input id="oc-supplier" list="oc-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="Fecha" htmlFor="oc-date">
            <Input id="oc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <datalist id="oc-suppliers">
          {[...new Set(prices.flatMap((m) => m.suppliers.map((s) => s.supplier)))].sort().map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Materiales</legend>
          {needs.map((n, i) => {
            const best = prices.find((m) => m.key === n.key)?.suppliers[0];
            return (
              <div key={n.lineId} className="grid grid-cols-[1fr_6rem_8rem] items-end gap-2 text-sm">
                <div className="min-w-0 break-words">
                  <strong>{n.projectCode}</strong> · {n.description}
                  <span className="block text-xs text-slate-500">
                    estimado {formatCurrency(n.estimatedUnitCost)}/{n.unit}
                    {best && ` · último de ${best.supplier}: ${formatCurrency(best.lastPrice)}`}
                  </span>
                </div>
                <Field label={`Cantidad (${n.unit})`} htmlFor={`oc-q-${n.lineId}`}>
                  <Input id={`oc-q-${n.lineId}`} inputMode="decimal" value={rows[i].qty} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))} />
                </Field>
                <Field label="Costo unitario real" htmlFor={`oc-c-${n.lineId}`}>
                  <Input id={`oc-c-${n.lineId}`} inputMode="decimal" value={rows[i].cost} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, cost: e.target.value } : r)))} />
                </Field>
              </div>
            );
          })}
        </fieldset>
        <Field label="Nota (opcional)" htmlFor="oc-notes">
          <Input id="oc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: entrega en planta, pago a 30 días" />
        </Field>
        <p className="text-sm text-slate-700">
          Total de la orden: <strong className="tabular">{formatCurrency(total)}</strong> ({formatNumber(needs.length)} {needs.length === 1 ? "material" : "materiales"})
        </p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Crear orden en Borrador</Button>
        </DialogFooter>
      </form>
      <p className="text-xs text-slate-500">
        Después, en <Link href="/compras/ordenes" className="text-blue-700 underline">Órdenes de compra</Link>: enviarla, registrar la factura, marcar pagada y recibir.
      </p>
    </>
  );
}
