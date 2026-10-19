"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
// Compras: Dashboard, Órdenes de compra (con precios por proveedor) y Alertas. Solo materiales: costo estimado,
// costo real (factura), proveedor y fechas. Nunca precio de venta, rentabilidad ni valor de la mano de obra.
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, FileText, PackageCheck, Receipt, Send, TrendingUp } from "lucide-react";
import type { PurchaseOrder } from "@/types";
import { formatCurrency, formatDate, formatNumber, formatQty, todayISO } from "@/lib/formatting";
import { projectHref } from "@/lib/permissions";
import {
  ORDER_RECEIVED_LABELS,
  ORDER_STATUS_LABELS,
  orderTotal,
  overBudgetPurchases,
  purchaseHistory,
  supplierPrices,
  toBuyWithin,
} from "@/lib/purchasing";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { useMaterialNeeds, usePurchasingAlerts, useToday } from "@/store/selectors";
import { AlertItem } from "@/components/alerts/alert-item";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatLink } from "@/components/shared/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NeedPill } from "./purchasing-projects";

/** Días que cuenta "esta semana". */
const WEEK_DAYS = 7;

const STATUS_TONE: Record<PurchaseOrder["status"], "gray" | "blue" | "green"> = { draft: "gray", sent: "blue", invoiced: "green" };

export function OrderBadges({ order: o }: { order: PurchaseOrder }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge tone={STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
      {o.status === "invoiced" && <Badge tone={o.paid ? "green" : "yellow"}>{o.paid ? "Pagada" : "Sin pagar"}</Badge>}
      {o.status !== "draft" && <Badge tone={o.received === "yes" ? "green" : o.received === "partial" ? "yellow" : "gray"}>Recibida: {ORDER_RECEIVED_LABELS[o.received]}</Badge>}
    </span>
  );
}

export function PurchasingDashboard() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const orders = useAppStore((s) => s.orders);
  const needs = useMaterialNeeds();
  const alerts = usePurchasingAlerts();
  const week = toBuyWithin(needs, today, WEEK_DAYS);
  const open = orders.filter((o) => o.lines.length > 0 && (o.status !== "invoiced" || o.received !== "yes"));
  const over = useMemo(() => overBudgetPurchases(projects), [projects]);

  return (
    <div className="space-y-6">
      <PageHeader title="Compras" subtitle={`Hoy, ${formatDate(today)}. Qué pedir, qué órdenes siguen abiertas y qué costó más de lo estimado.`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatLink icon={CalendarClock} label="Para pedir esta semana" value={String(week.length)} href="#esta-semana" tone={week.length ? "warn" : undefined} />
        <StatLink icon={FileText} label="Órdenes abiertas" value={String(open.length)} href="/compras/ordenes" />
        <StatLink icon={TrendingUp} label="Compras sobre lo estimado" value={String(over.length)} href="#sobre-estimado" tone={over.length ? "warn" : undefined} />
        <StatLink icon={AlertTriangle} label="Alertas de compras" value={String(alerts.length)} href="/compras/alertas" tone={alerts.length ? "warn" : undefined} />
      </div>

      <Card id="esta-semana">
        <CardHeader>
          <CardTitle>Qué hay que pedir esta semana</CardTitle>
          <p className="text-sm text-slate-500">Materiales de proyectos que arrancan en {WEEK_DAYS} días o menos (o que ya arrancaron) y todavía faltan pedir.</p>
        </CardHeader>
        <CardContent>
          {week.length === 0 ? (
            <p className="text-sm text-slate-500">No hay nada urgente para pedir.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {week.map((n) => (
                <li key={`${n.projectId}-${n.lineId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-words">
                    <strong>{n.description}</strong> · falta pedir {formatQty(n.toBuy, n.unit)}
                    <span className="block text-xs text-slate-500">
                      {n.projectCode} · se necesita {n.needBy < today ? `desde el ${formatDate(n.needBy)}` : `el ${formatDate(n.needBy)}`}
                    </span>
                  </span>
                  <NeedPill status={n.status} />
                </li>
              ))}
            </ul>
          )}
          <Link href="/compras/proyectos" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Ir a Necesidades para generar la orden de compra
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Órdenes abiertas</CardTitle>
          <p className="text-sm text-slate-500">Las que falta enviar, facturar o recibir.</p>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-slate-500">No hay órdenes abiertas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {open.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-words">
                    <Link href="/compras/ordenes" className="font-medium text-blue-700 hover:underline">{o.number}</Link> · {o.supplier} · {formatCurrency(orderTotal(o))}
                  </span>
                  <OrderBadges order={o} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card id="sobre-estimado">
        <CardHeader>
          <CardTitle>Compras que costaron más de lo estimado</CardTitle>
          <p className="text-sm text-slate-500">Costo real (factura) contra el costo unitario estimado del mismo material en el proyecto.</p>
        </CardHeader>
        <CardContent>
          {over.length === 0 ? (
            <p className="text-sm text-slate-500">Ninguna compra costó más de lo estimado.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {over.map((o) => (
                <li key={o.purchaseId} className="py-2 text-sm">
                  <span className="break-words">
                    <strong>{o.projectCode}</strong> · {o.materialName}: {formatCurrency(o.paidUnitCost)} contra {formatCurrency(o.budgetUnitCost)} estimado (+{formatNumber(o.pct, 1)} %)
                  </span>
                  <span className="block text-xs text-slate-500">
                    {formatDate(o.date)} · {o.supplier ?? "sin proveedor"} · {formatQty(o.quantity, o.unit)} · {formatCurrency(o.overBy)} más
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PurchasingAlertsPage() {
  const alerts = usePurchasingAlerts();
  return (
    <div className="space-y-6">
      <PageHeader title="Alertas de compras" subtitle="Material que se necesita en pocos días y falta pedir (Configuración → Alertas), y compras que costaron más de lo estimado." />
      {alerts.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Sin alertas de compras" description="Cuando falte pedir algo cerca del inicio de un proyecto o una compra cueste más, aparece acá." />
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <AlertItem key={a.id} alert={a} readOnly link={{ href: projectHref("compras", a.projectId), label: "Ver necesidades" }} />
          ))}
        </div>
      )}
    </div>
  );
}

type Action = { kind: "invoice" | "receive"; order: PurchaseOrder } | null;

export function OrdersPage() {
  // Las órdenes sin líneas (sus proyectos se borraron al restaurar la demo) no se muestran; siguen contando para el número.
  const allOrders = useAppStore((s) => s.orders);
  const orders = allOrders.filter((o) => o.lines.length > 0);
  const projects = useAppStore((s) => s.projects);
  const stock = useAppStore((s) => s.stock);
  const sendOrder = useConfirmedAction("sendOrder");
  const setOrderPaid = useConfirmedAction("setOrderPaid");
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState("");
  const history = useMemo(() => purchaseHistory(projects, stock), [projects, stock]);
  const prices = useMemo(() => supplierPrices(history), [history]);
  const code = (id: string) => projects.find((p) => p.id === id)?.code ?? id;
  const run = (r: { ok: boolean; error?: string }) => setError(r.ok ? "" : (r.error ?? ""));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Órdenes de compra"
        subtitle="Borrador → Enviada → Facturada (el costo real del proyecto cambia al facturar). Pagada y Recibida van aparte. Registro manual: sin mail ni banco."
      />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Tabs defaultValue="ordenes">
        <TabsList>
          <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
          <TabsTrigger value="precios">Precios por proveedor</TabsTrigger>
        </TabsList>
        <TabsContent value="ordenes" className="space-y-4">
          {orders.length === 0 ? (
            <EmptyState icon={FileText} title="Todavía no hay órdenes" description="Generalas desde Necesidades eligiendo los materiales." />
          ) : (
            [...orders]
              .sort((a, b) => b.number.localeCompare(a.number))
              .map((o) => (
                <Card key={o.id} role="region" aria-label={`Orden ${o.number}`}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {o.number} <span className="font-normal text-slate-600">· {o.supplier}</span> <OrderBadges order={o} />
                    </CardTitle>
                    <p className="text-sm text-slate-500">
                      {formatDate(o.date)} · total {formatCurrency(orderTotal(o))}
                      {o.invoiceNumber && ` · factura ${o.invoiceNumber} del ${formatDate(o.invoiceDate ?? o.date)} por ${formatCurrency(o.invoiceAmount ?? 0)}`}
                      {o.notes && ` · ${o.notes}`}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ul className="divide-y divide-slate-100 text-sm">
                      {o.lines.map((l) => (
                        <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                          <span className="min-w-0 break-words">
                            <strong>{code(l.projectId)}</strong> · {l.materialName}
                          </span>
                          <span className="tabular text-slate-600">
                            {formatQty(l.quantity, l.unit)} × {formatCurrency(l.unitCost)} · recibido {formatNumber(l.receivedQuantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      {o.status === "draft" && (
                        <Button size="sm" onClick={async () => run(await sendOrder(o.id))}>
                          <Send /> Marcar como enviada
                        </Button>
                      )}
                      {o.status === "sent" && (
                        <Button size="sm" onClick={() => setAction({ kind: "invoice", order: o })}>
                          <Receipt /> Registrar factura
                        </Button>
                      )}
                      {o.status === "invoiced" && (
                        <Button size="sm" variant="outline" onClick={async () => run(await setOrderPaid(o.id, !o.paid))}>
                          {o.paid ? "Marcar como no pagada" : "Marcar como pagada"}
                        </Button>
                      )}
                      {o.status !== "draft" && o.received !== "yes" && (
                        <Button size="sm" variant="outline" onClick={() => setAction({ kind: "receive", order: o })}>
                          <PackageCheck /> Recibir
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
          )}
        </TabsContent>
        <TabsContent value="precios" className="space-y-3">
          {prices.map((m) => (
            <Card key={m.key}>
              <CardHeader>
                <CardTitle className="text-base">{m.materialName}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Proveedor</TH>
                      <TH className="text-right">Último precio</TH>
                      <TH>Fecha</TH>
                      <TH className="text-right">Mínimo</TH>
                      <TH className="text-right">Máximo</TH>
                      <TH className="text-right">Compras</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {m.suppliers.map((s, i) => (
                      <TR key={s.supplier}>
                        <TD className="font-medium text-slate-900">
                          {s.supplier}
                          {i === 0 && m.suppliers.length > 1 && <span className="ml-1 text-xs font-normal text-emerald-700">(más barato)</span>}
                        </TD>
                        <TD className="whitespace-nowrap text-right tabular">{formatCurrency(s.lastPrice)}/{m.unit}</TD>
                        <TD className="whitespace-nowrap tabular">{formatDate(s.lastDate)}</TD>
                        <TD className="whitespace-nowrap text-right tabular">{formatCurrency(s.minPrice)}</TD>
                        <TD className="whitespace-nowrap text-right tabular">{formatCurrency(s.maxPrice)}</TD>
                        <TD className="text-right tabular">{s.purchases}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
      <InvoiceDialog order={action?.kind === "invoice" ? action.order : null} onClose={() => setAction(null)} />
      <ReceiveDialog order={action?.kind === "receive" ? action.order : null} onClose={() => setAction(null)} />
    </div>
  );
}

function InvoiceDialog({ order, onClose }: { order: PurchaseOrder | null; onClose: () => void }) {
  const invoiceOrder = useConfirmedAction("invoiceOrder");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");
  return (
    <Dialog open={order !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {order && (
          <form
            noValidate
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await invoiceOrder(order.id, { invoiceNumber: number, invoiceAmount: parseDecimal(amount || String(orderTotal(order))), invoiceDate: date });
              if (!r.ok) return setError(r.error);
              setNumber("");
              setAmount("");
              onClose();
            }}
          >
            <DialogHeader>
              <DialogTitle>Factura de {order.number}</DialogTitle>
              <DialogDescription>Registra el importe comprado por proyecto. El costo imputable se registra al consumir o desperdiciar material. Total de líneas ({formatCurrency(orderTotal(order))}).</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3">
              <Field label="N° de factura" htmlFor="inv-n">
                <Input id="inv-n" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="A-0001-00001234" />
              </Field>
              <Field label="Monto" htmlFor="inv-a">
                <Input id="inv-a" inputMode="decimal" value={amount} placeholder={String(orderTotal(order))} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Fecha" htmlFor="inv-d">
                <Input id="inv-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            {amount && Math.abs(parseDecimal(amount) - orderTotal(order)) > .01 && <p role="alert" className="text-sm text-amber-800">La factura difiere de las líneas en {formatCurrency(parseDecimal(amount)-orderTotal(order))}. La diferencia queda sin distribuir: no cambia el costo del material. Revisá impuestos, fletes y descuentos; registrá un costo adicional solo si corresponde.</p>}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit">Registrar factura</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ order, onClose }: { order: PurchaseOrder | null; onClose: () => void }) {
  return (
    <Dialog open={order !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{order && <ReceiveForm key={order.id} order={order} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ReceiveForm({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const receiveOrder = useConfirmedAction("receiveOrder");
  const projects = useAppStore((s) => s.projects);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(order.lines.map((l) => [l.id, String(Math.max(0, l.quantity - l.receivedQuantity)).replace(".", ",")])));
  const [error, setError] = useState("");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await receiveOrder(order.id, order.lines.map((l) => ({ lineId: l.id, quantity: parseDecimal(qty[l.id] ?? "") || 0 })));
        if (!r.ok) return setError(r.error);
        onClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>Recibir {order.number}</DialogTitle>
        <DialogDescription>Lo que llegó entra al stock de cada proyecto con el costo real de la orden. Se puede recibir en partes.</DialogDescription>
      </DialogHeader>
      {order.lines.map((l) => (
        <div key={l.id} className="grid grid-cols-[1fr_7rem] items-end gap-2 text-sm">
          <span className="min-w-0 break-words">
            <strong>{projects.find((p) => p.id === l.projectId)?.code}</strong> · {l.materialName}
            <span className="block text-xs text-slate-500">pedido {formatQty(l.quantity, l.unit)} · ya recibido {formatNumber(l.receivedQuantity)}</span>
          </span>
          <Field label={`Llegó (${l.unit})`} htmlFor={`rcv-${l.id}`}>
            <Input id={`rcv-${l.id}`} inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
          </Field>
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit">Registrar recepción</Button>
      </DialogFooter>
    </form>
  );
}
