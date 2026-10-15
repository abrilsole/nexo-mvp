"use client";
// Compras (Lote 5A, vista mínima): proyectos abiertos con su lista de materiales y costo de compra.
// Nunca precio de venta, rentabilidad ni valor de la mano de obra (lib/role-views.ts).
import { useMemo } from "react";
import { ClipboardList } from "lucide-react";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatting";
import { purchasingView } from "@/lib/role-views";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export function PurchasingPage() {
  const projects = useAppStore((s) => s.projects);
  const boms = useMemo(() => purchasingView(projects), [projects]);

  return (
    <div className="space-y-6">
      <PageHeader title="Materiales por proyecto" subtitle="Lo que hay que comprar en cada proyecto abierto, con el costo de compra presupuestado y lo ya comprado." />
      {boms.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No hay proyectos abiertos" description="Cuando haya proyectos en curso, acá vas a ver su lista de materiales." />
      ) : (
        boms.map((b) => (
          <Card key={b.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">{b.code}</span> {b.name} <StatusBadge status={b.status} />
              </CardTitle>
              <p className="text-sm text-slate-500">
                {b.client} · entrega {formatDate(b.dueDate)}
              </p>
            </CardHeader>
            <CardContent>
              {b.lines.length === 0 ? (
                <p className="text-sm text-slate-500">Este proyecto todavía no tiene materiales presupuestados.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Material</TH>
                        <TH className="text-right">Cantidad</TH>
                        <TH>Unidad</TH>
                        <TH className="text-right">Comprado</TH>
                        <TH className="text-right">Costo unitario</TH>
                        <TH className="text-right">Total</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {b.lines.map((l) => (
                        <TR key={l.key}>
                          <TD className="font-medium text-slate-900">{l.description}</TD>
                          <TD className="text-right tabular">{l.quantity === null ? "—" : formatNumber(l.quantity)}</TD>
                          <TD>{l.quantity === null ? "monto directo" : l.unit}</TD>
                          <TD className="text-right tabular">{formatNumber(l.purchased)}</TD>
                          <TD className="text-right tabular">{l.quantity === null ? "—" : formatCurrency(l.unitCost)}</TD>
                          <TD className="text-right tabular">{formatCurrency(l.total)}</TD>
                        </TR>
                      ))}
                      <TR className="bg-slate-50 font-semibold">
                        <TD colSpan={5}>Costo de materiales presupuestado</TD>
                        <TD className="text-right tabular">{formatCurrency(b.materialsCost)}</TD>
                      </TR>
                    </TBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
