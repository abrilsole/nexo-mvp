"use client";
// Cotizador de materiales (Compras, Lote 5C): la variante del Cotizador que solo trabaja con materiales y su costo.
// Sin mano de obra, sin precio sugerido y sin rentabilidad (ver docs/ROLES_Y_PERMISOS.md). Usa las mismas filas de
// materiales que el Cotizador y muestra el último precio pagado por proveedor para comparar.
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatting";
import { materialKey } from "@/lib/material-reconciliation";
import { materialsQuote, purchaseHistory, supplierPrices } from "@/lib/purchasing";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MaterialCatalogList, MaterialRows } from "@/components/budget/material-rows";
import { materialRowToQuote, newMaterialRow, type MaterialRow } from "@/components/budget/calculator-state";

export function MaterialsQuotePage() {
  const projects = useAppStore((s) => s.projects);
  const stock = useAppStore((s) => s.stock);
  const [rows, setRows] = useState<MaterialRow[]>(() => [newMaterialRow()]);
  const materials = rows.map(materialRowToQuote);
  const quote = materialsQuote(materials);
  const prices = useMemo(() => supplierPrices(purchaseHistory(projects, stock)), [projects, stock]);

  return (
    <div>
      <PageHeader
        title="Cotizador de materiales"
        subtitle="Cuánto cuesta comprar los materiales de un trabajo: cantidad, desperdicio y costo de compra."
        actions={
          <Button variant="outline" onClick={() => setRows([newMaterialRow()])}>
            <RotateCcw /> Empezar de nuevo
          </Button>
        }
      />
      <MaterialCatalogList />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="Materiales a cotizar">
          <MaterialRows materials={rows} onChange={setRows} owner="la cotización" />
        </section>
        <aside aria-label="Resumen de la cotización de materiales" className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardContent className="space-y-3 pt-5 text-sm">
              <h2 className="text-sm font-semibold text-slate-900">Resumen <span className="font-normal text-slate-500">(sin IVA)</span></h2>
              {quote.lines.length === 0 ? (
                <p className="text-slate-500">Cargá al menos un material con cantidad.</p>
              ) : (
                <ul className="space-y-2">
                  {quote.lines.map((l, i) => {
                    const known = prices.find((p) => p.key === materialKey(l.materialId, l.name))?.suppliers[0];
                    return (
                      <li key={`${l.name}-${i}`} className="border-b border-slate-100 pb-2 last:border-0">
                        <div className="flex justify-between gap-2">
                          <span className="min-w-0 break-words">{l.name}</span>
                          <span className="shrink-0 tabular">{formatCurrency(l.total)}</span>
                        </div>
                        <p className="text-xs text-slate-500 tabular">
                          {formatNumber(l.budgetQuantity, 2)} {l.unit || "u"} × {formatCurrency(l.unitCost)}
                        </p>
                        {known && (
                          <p className="text-xs text-slate-500">
                            Más barato la última vez: {known.supplier}, {formatCurrency(known.lastPrice)} ({formatDate(known.lastDate)})
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex items-baseline justify-between gap-2 border-t border-slate-100 pt-3">
                <span className="text-slate-500">Costo de materiales</span>
                <span className="text-2xl font-semibold tabular text-slate-900" aria-live="polite">{formatCurrency(quote.total)}</span>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
