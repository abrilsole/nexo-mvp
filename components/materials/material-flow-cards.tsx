"use client";
import type { Project } from "@/types";
import { projectMaterialFlow } from "@/lib/material-flow";
import { formatCurrency } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { cn } from "@/lib/utils";

function Cell({ label, value, hint, tone, tooltip }: { label: string; value: number; hint: string; tone?: "cost" | "neutral"; tooltip?: string }) {
  return (
    <div className={cn("rounded-lg border p-3", tone === "cost" ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50/60")}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {label}
        {tooltip && <HelpTip label={label}>{tooltip}</HelpTip>}
      </div>
      <div className={cn("mt-1 text-lg font-semibold tabular", tone === "cost" ? "text-slate-900" : "text-slate-700")}>{formatCurrency(value)}</div>
      <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

/**
 * Qué pasó con el material de este proyecto. Sólo "consumido" y "desperdiciado" son costo;
 * lo comprado, lo recuperado y lo transferido se ven pero no se imputan.
 */
export function MaterialFlowCards({ project }: { project: Project }) {
  const stock = useAppStore((s) => s.stock);
  const flow = projectMaterialFlow(stock, project.id);
  const t = flow.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Qué pasó con el material</CardTitle>
        <CardDescription>
          El costo de materiales del proyecto es lo <strong>consumido + desperdiciado</strong>. Lo comprado no es costo hasta que se usa; lo que vuelve al stock, queda de sobrante o se transfiere conserva su valor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Cell label="Comprado" value={t.purchased} hint="No es costo todavía" />
          <Cell label="Consumido" value={t.consumed} hint="Es costo" tone="cost" />
          <Cell label="Desperdiciado" value={t.wasted} hint="Es costo; no se reutiliza" tone="cost" />
          <Cell label="Recuperado" value={t.recovered} hint="Volvió al stock o quedó de sobrante" />
          <Cell label="Transferido" value={t.transferredOut} hint="Pasó a otros proyectos" />
          <Cell label="Asignado sin usar" value={t.held} hint="Hay que darle destino al cerrar" />
        </div>
        {(t.fromStock > 0 || t.transferredIn > 0 || t.returned > 0) && (
          <p className="mt-3 text-xs text-slate-500">
            {t.fromStock > 0 && <>Tomado del stock: {formatCurrency(t.fromStock)}. </>}
            {t.transferredIn > 0 && <>Recibido de otros proyectos: {formatCurrency(t.transferredIn)}. </>}
            {t.returned > 0 && <>Devuelto a proveedor: {formatCurrency(t.returned)}.</>}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-blue-50 px-4 py-3">
          <span className="text-sm font-medium text-blue-900">Costo de materiales imputable al proyecto</span>
          <span className="text-xl font-semibold tabular text-blue-900">{formatCurrency(flow.attributableCost)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
