"use client";
// Compras → Proyectos: lista de materiales (BOM) de uno o varios proyectos, por proyecto o consolidada
// (el mismo material de varios proyectos junto, para comprarlo una sola vez). Estado por línea:
// pendiente → cotizando → comprado → recibido. Sin precio de venta, rentabilidad ni mano de obra.
import { useMemo, useState } from "react";
import { ClipboardList, ShoppingCart } from "lucide-react";
import type { LineStatus } from "@/types";
import { formatCurrency, formatDate, formatQty } from "@/lib/formatting";
import { consolidate, LINE_STATUS_LABELS, LINE_STATUSES, purchaseLines, type PurchaseLine } from "@/lib/purchasing";
import { useAppStore } from "@/store/use-app-store";
import { useToday } from "@/store/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Choice } from "@/components/ui/choice";
import { Select } from "@/components/ui/input";
import { RecordPurchaseDialog } from "./record-purchase-dialog";

type View = "project" | "consolidated";

const STATUS_TONE: Record<LineStatus, "gray" | "yellow" | "blue" | "green"> = { pending: "gray", quoting: "yellow", purchased: "blue", received: "green" };

export function StatusPill({ status }: { status: LineStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{LINE_STATUS_LABELS[status]}</Badge>;
}

const when = (l: Pick<PurchaseLine, "needBy" | "daysLeft">) =>
  l.daysLeft < 0 ? `se necesitaba el ${formatDate(l.needBy)}` : l.daysLeft === 0 ? "se necesita hoy" : `se necesita el ${formatDate(l.needBy)}`;

export function PurchasingProjectsPage({ projectId }: { projectId?: string }) {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const statuses = useAppStore((s) => s.lineStatuses);
  const setLineStatus = useAppStore((s) => s.setLineStatus);
  const open = useMemo(() => projects.filter((p) => !p.isClosed).sort((a, b) => a.startDate.localeCompare(b.startDate)), [projects]);
  const [selected, setSelected] = useState<string[]>(() => (projectId && open.some((p) => p.id === projectId) ? [projectId] : open.map((p) => p.id)));
  const [view, setView] = useState<View>("project");
  const [buying, setBuying] = useState<PurchaseLine[] | null>(null);
  const [error, setError] = useState("");
  const lines = useMemo(() => purchaseLines(projects, statuses, today).filter((l) => selected.includes(l.projectId)), [projects, statuses, today, selected]);

  const changeStatus = (l: PurchaseLine, status: LineStatus) => {
    setError("");
    // "Comprado" pide los datos de la compra real (proveedor, precio pagado, fecha y cantidad).
    if (status === "purchased" && l.remaining > 0) return setBuying([l]);
    const r = setLineStatus(l.projectId, l.lineId, status);
    if (!r.ok) setError(r.error);
  };
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="space-y-6">
      <PageHeader title="Proyectos" subtitle="Lista de materiales de cada proyecto, con lo comprado, lo que falta y el estado de cada línea." />

      <Card>
        <CardContent className="space-y-4 pt-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Proyectos</legend>
            <div className="flex flex-wrap gap-2">
              {open.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm has-[:checked]:border-blue-400 has-[:checked]:bg-blue-50">
                  <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} className="size-4" />
                  <span className="min-w-0 break-words"><strong>{p.code}</strong> {p.name}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(open.map((p) => p.id))}>Todos</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Ninguno</Button>
            </div>
          </fieldset>
          <div className="max-w-sm">
            <Choice<View>
              name="Cómo ver los materiales"
              value={view}
              onChange={setView}
              options={[
                { value: "project", label: "Por proyecto" },
                { value: "consolidated", label: "Consolidado" },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {lines.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No hay materiales para mostrar" description="Elegí uno o más proyectos con materiales presupuestados." />
      ) : view === "project" ? (
        open
          .filter((p) => selected.includes(p.id))
          .map((p) => {
            const mine = lines.filter((l) => l.projectId === p.id);
            return (
              <Card key={p.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">{p.code}</span> {p.name} <StatusBadge status={p.status} />
                  </CardTitle>
                  <p className="text-sm text-slate-500">
                    {p.client} · inicio {formatDate(p.startDate)} · entrega {formatDate(p.dueDate)}
                    {p.status === "quotation" && " · en Cotización: todavía no se compra"}
                  </p>
                </CardHeader>
                <CardContent>
                  {mine.length === 0 ? (
                    <p className="text-sm text-slate-500">Este proyecto todavía no tiene materiales presupuestados.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {mine.map((l) => (
                        <LineRow key={l.lineId} line={l} onStatus={(s) => changeStatus(l, s)} onBuy={() => setBuying([l])} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Consolidado</CardTitle>
            <p className="text-sm text-slate-500">El mismo material de los proyectos elegidos, junto: se compra una sola vez y se reparte.</p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {consolidate(lines).map((c) => {
                const buyable = c.lines.filter((l) => l.canBuy && l.remaining > 0);
                return (
                  <li key={`${c.key}|${c.unit}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words font-medium text-slate-900">{c.description}</span>
                        <StatusPill status={c.status} />
                      </div>
                      <p className="text-sm text-slate-600">
                        Falta {formatQty(c.remaining, c.unit)} de {formatQty(c.needed, c.unit)} · presupuestado {formatCurrency(c.budgetTotal)} · primero el {formatDate(c.needBy)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {c.lines.map((l) => `${l.projectCode}: falta ${formatQty(l.remaining, l.unit)}`).join(" · ")}
                      </p>
                    </div>
                    {buyable.length > 0 && (
                      <Button size="sm" className="shrink-0" onClick={() => setBuying(buyable)}>
                        <ShoppingCart /> Registrar compra
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <RecordPurchaseDialog lines={buying} onClose={() => setBuying(null)} />
    </div>
  );
}

function LineRow({ line: l, onStatus, onBuy }: { line: PurchaseLine; onStatus: (s: LineStatus) => void; onBuy: () => void }) {
  const id = `st-${l.projectId}-${l.lineId}`;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <span className="break-words font-medium text-slate-900">{l.description}</span>
        <p className="text-sm text-slate-600">
          {l.quantity === null ? "Monto directo" : `${formatQty(l.needed, l.unit)} a ${formatCurrency(l.budgetUnitCost)}`} · presupuestado {formatCurrency(l.budgetTotal)}
        </p>
        <p className="text-xs text-slate-500">
          Comprado {formatQty(l.purchased, l.unit)}
          {l.purchased > 0 && ` (pagado ${formatCurrency(l.paidTotal)})`}
          {l.remaining > 0 && ` · falta ${formatQty(l.remaining, l.unit)} · ${when(l)}`}
          {l.overBy > 0 && <span className="font-medium text-amber-800"> · {formatCurrency(l.overBy)} más caro que lo presupuestado</span>}
        </p>
      </div>
      {l.canBuy && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label htmlFor={id} className="sr-only">Estado de {l.description}</label>
          <Select id={id} value={l.status} onChange={(e) => onStatus(e.target.value as LineStatus)} className="w-36">
            {LINE_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === "received" && l.purchased === 0}>
                {LINE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          {l.remaining > 0 && (
            <Button size="sm" variant="outline" onClick={onBuy}>
              <ShoppingCart /> Registrar compra
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
