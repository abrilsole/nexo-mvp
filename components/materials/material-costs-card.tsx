"use client";
// Materiales del proyecto: costo ESTIMADO (lo cargó el Administrativo al crear el proyecto, de memoria) contra costo
// REAL (lo facturado en las órdenes de compra y las compras directas). "Pagada" no cambia el costo. Cada importe real se
// abre hasta la factura y la orden de compra que lo generan (Lote 6).
import { useMemo } from "react";
import type { Project } from "@/types";
import { formatCurrency, formatDate, formatQty, formatSignedCurrency } from "@/lib/formatting";
import { materialCosts } from "@/lib/purchasing";
import { useAppStore } from "@/store/use-app-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MaterialCostsCard({ project }: { project: Project }) {
  const orders = useAppStore((s) => s.orders);
  const costs = useMemo(() => materialCosts(project, orders), [project, orders]);
  if (costs.rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compra de materiales: estimado vs real</CardTitle>
        <CardDescription>
          Estimado = cantidad × costo unitario estimado al crear el proyecto (de memoria). Real = lo facturado (órdenes de compra) y las compras directas. Que
          una factura esté pagada no cambia el costo. Esto es la <strong>compra</strong>: el consumo, el desperdicio y el sobrante reutilizable están abajo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-3 tabular">
          <span>Estimado <strong className="block text-base">{formatCurrency(costs.estimated)}</strong></span>
          <span>Real (facturado) <strong className="block text-base">{formatCurrency(costs.real)}</strong></span>
          <span>
            Diferencia en lo facturado
            <strong className={cn("block text-base", costs.diff > 0 ? "text-red-700" : costs.diff < 0 ? "text-emerald-700" : "")}>{formatSignedCurrency(costs.diff)}</strong>
          </span>
        </div>
        {costs.pendingEstimated > 0 && (
          <p className="text-xs text-slate-500">
            Falta facturar materiales estimados en {formatCurrency(costs.pendingEstimated)}: no entran en la diferencia hasta que llegue su factura.
          </p>
        )}
        <ul className="divide-y divide-slate-100">
          {costs.rows.map((r) => (
            <li key={r.lineId} className="py-2">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{r.description}</span>
                  <span className="tabular text-slate-600">
                    estimado {formatCurrency(r.estimated)}
                    {r.estimatedQuantity !== null && ` (${formatQty(r.estimatedQuantity, r.unit)} × ${formatCurrency(r.estimatedUnitCost)})`} · real{" "}
                    {formatCurrency(r.real)}
                    {r.real > 0 && <span className={cn("ml-1", r.diff > 0 ? "text-red-700" : "text-emerald-700")}>{formatSignedCurrency(r.diff)}</span>}
                  </span>
                </summary>
                {r.sources.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">Todavía no hay facturas ni compras de este material.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5 pl-4 text-xs text-slate-600">
                    {r.sources.map((x) => (
                      <li key={x.entryId}>
                        {x.label} · {x.supplier ?? "sin proveedor"} · {formatDate(x.date)} · {formatQty(x.quantity, r.unit)} × {formatCurrency(x.unitCost)} ={" "}
                        {formatCurrency(x.total)}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
