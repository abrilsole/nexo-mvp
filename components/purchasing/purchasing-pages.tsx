"use client";
// Compras: Dashboard, Alertas e Historial. Solo materiales: costo presupuestado de compra, precio pagado y proveedor.
// Nunca precio de venta, rentabilidad ni valor de la mano de obra.
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, ClipboardList, TrendingUp } from "lucide-react";
import { formatCurrency, formatDate, formatNumber, formatQty } from "@/lib/formatting";
import { projectHref } from "@/lib/permissions";
import {
  consolidate,
  isOpenStatus,
  LINE_STATUS_LABELS,
  overBudgetPurchases,
  pendingLines,
  purchaseHistory,
  purchaseLines,
  supplierPrices,
  toBuyWithin,
} from "@/lib/purchasing";
import { useAppStore } from "@/store/use-app-store";
import { usePurchasingAlerts, useToday } from "@/store/selectors";
import { AlertItem } from "@/components/alerts/alert-item";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatLink } from "@/components/shared/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusPill } from "./purchasing-projects";

/** Días que cuenta "esta semana". */
const WEEK_DAYS = 7;

function usePurchaseLines() {
  const projects = useAppStore((s) => s.projects);
  const statuses = useAppStore((s) => s.lineStatuses);
  const today = useToday();
  return useMemo(() => purchaseLines(projects, statuses, today), [projects, statuses, today]);
}

export function PurchasingDashboard() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const lines = usePurchaseLines();
  const alerts = usePurchasingAlerts();
  const week = useMemo(() => consolidate(toBuyWithin(lines, today, WEEK_DAYS)), [lines, today]);
  const pending = pendingLines(lines);
  const over = useMemo(() => overBudgetPurchases(projects), [projects]);
  const byStatus = (["pending", "quoting"] as const).map((s) => ({ s, n: pending.filter((l) => l.status === s).length }));

  return (
    <div className="space-y-6">
      <PageHeader title="Compras" subtitle={`Hoy, ${formatDate(today)}. Qué comprar, qué falta y qué se pagó más caro de lo presupuestado.`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatLink icon={CalendarClock} label="Para comprar esta semana" value={String(week.length)} href="#esta-semana" tone={week.length ? "warn" : undefined} />
        <StatLink icon={ClipboardList} label="Líneas pendientes o cotizando" value={String(pending.length)} href="/compras/proyectos" />
        <StatLink icon={TrendingUp} label="Compras sobre presupuesto" value={String(over.length)} href="#sobre-presupuesto" tone={over.length ? "warn" : undefined} />
        <StatLink icon={AlertTriangle} label="Alertas de compras" value={String(alerts.length)} href="/compras/alertas" tone={alerts.length ? "warn" : undefined} />
      </div>

      <Card id="esta-semana">
        <CardHeader>
          <CardTitle>Qué hay que comprar esta semana</CardTitle>
          <p className="text-sm text-slate-500">Material sin comprar de proyectos que arrancan en {WEEK_DAYS} días o menos (o que ya arrancaron). El mismo material va junto.</p>
        </CardHeader>
        <CardContent>
          {week.length === 0 ? (
            <p className="text-sm text-slate-500">No hay nada urgente para comprar.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {week.map((c) => (
                <li key={`${c.key}|${c.unit}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-words">
                    <strong>{c.description}</strong> · falta {formatQty(c.remaining, c.unit)}
                    <span className="block text-xs text-slate-500">
                      {c.lines.map((l) => l.projectCode).join(", ")} · se necesita {c.needBy < today ? `desde el ${formatDate(c.needBy)}` : `el ${formatDate(c.needBy)}`}
                    </span>
                  </span>
                  <StatusPill status={c.status} />
                </li>
              ))}
            </ul>
          )}
          <Link href="/compras/proyectos" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Ir a Proyectos para registrar las compras
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compras pendientes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            {byStatus.map(({ s, n }) => `${LINE_STATUS_LABELS[s]}: ${n}`).join(" · ")}
          </p>
          {pending.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {pending.slice(0, 8).map((l) => (
                <li key={`${l.projectId}-${l.lineId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-words">
                    <Link href={projectHref("compras", l.projectId)} className="font-medium text-blue-700 hover:underline">{l.projectCode}</Link> · {l.description} · falta{" "}
                    {formatQty(l.remaining, l.unit)}
                  </span>
                  {isOpenStatus(l.status) && <StatusPill status={l.status} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card id="sobre-presupuesto">
        <CardHeader>
          <CardTitle>Compras que se pasaron del presupuesto</CardTitle>
          <p className="text-sm text-slate-500">Precio pagado contra el costo de compra presupuestado del mismo material en el proyecto.</p>
        </CardHeader>
        <CardContent>
          {over.length === 0 ? (
            <p className="text-sm text-slate-500">Ninguna compra se pasó del presupuesto.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {over.map((o) => (
                <li key={o.purchaseId} className="py-2 text-sm">
                  <span className="break-words">
                    <strong>{o.projectCode}</strong> · {o.materialName}: {formatCurrency(o.paidUnitCost)} contra {formatCurrency(o.budgetUnitCost)} (+{formatNumber(o.pct, 1)} %)
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
      <PageHeader
        title="Alertas de compras"
        subtitle="Material que se necesita en pocos días y todavía no se compró (Configuración → Alertas), y compras más caras que lo presupuestado."
      />
      {alerts.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Sin alertas de compras" description="Cuando falte comprar algo cerca del inicio de un proyecto o una compra salga más cara, aparece acá." />
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <AlertItem key={a.id} alert={a} readOnly link={{ href: projectHref("compras", a.projectId), label: "Ver materiales" }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PurchaseHistoryPage() {
  const projects = useAppStore((s) => s.projects);
  const stock = useAppStore((s) => s.stock);
  const history = useMemo(() => purchaseHistory(projects, stock), [projects, stock]);
  const prices = useMemo(() => supplierPrices(history), [history]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <PageHeader title="Historial" subtitle="Compras realizadas y precios de cada material por proveedor (precios de compra, sin importes de venta)." />
      <div className="max-w-sm">
        <label htmlFor="hist-q" className="sr-only">Buscar material o proveedor</label>
        <Input id="hist-q" placeholder="Buscar material o proveedor" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <Tabs defaultValue="compras">
        <TabsList>
          <TabsTrigger value="compras">Compras</TabsTrigger>
          <TabsTrigger value="precios">Precios por proveedor</TabsTrigger>
        </TabsList>
        <TabsContent value="compras">
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Material</TH>
                    <TH>Proveedor</TH>
                    <TH>Para</TH>
                    <TH className="text-right">Cantidad</TH>
                    <TH className="text-right">Precio pagado</TH>
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {history
                    .filter((r) => match(r.materialName, r.supplier, r.destination))
                    .map((r) => (
                      <TR key={r.id}>
                        <TD className="whitespace-nowrap tabular">{formatDate(r.date)}</TD>
                        <TD className="font-medium text-slate-900">{r.materialName}</TD>
                        <TD>{r.supplier}</TD>
                        <TD>{r.destination}</TD>
                        <TD className="whitespace-nowrap text-right tabular">{formatQty(r.quantity, r.unit)}</TD>
                        <TD className="whitespace-nowrap text-right tabular">{formatCurrency(r.unitCost)}</TD>
                        <TD className="whitespace-nowrap text-right tabular">{formatCurrency(r.total)}</TD>
                      </TR>
                    ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="precios" className="space-y-3">
          {prices
            .filter((m) => match(m.materialName, ...m.suppliers.map((s) => s.supplier)))
            .map((m) => (
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
    </div>
  );
}
