"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Project } from "@/types";
import { CATEGORY_LABELS } from "@/lib/constants";
import { projectEconomics } from "@/lib/calculations";
import { projectMaterialFlow, unresolvedMaterial } from "@/lib/material-flow";
import { closingSummary } from "@/lib/insights";
import { formatCurrency, formatCurrencyOrDash, formatMarginPoints, formatPercent, formatQty, formatSignedCurrency, todayISO } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StockActionDialog, type StockAction, type StockTarget } from "@/components/stock/stock-action-dialog";

export function CloseDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const closeProject = useConfirmedAction("closeProject");
  const [step, setStep] = useState<0 | 1>(0);
  const stock = useAppStore((s) => s.stock);
  const registerUsage = useConfirmedAction("registerUsage");
  const [error, setError] = useState("");
  const [act, setAct] = useState<{ action: StockAction; target: StockTarget } | null>(null);
  const loose = useMemo(() => unresolvedMaterial(stock, project.id), [stock, project.id]);
  const flow = useMemo(() => projectMaterialFlow(stock, project.id), [stock, project.id]);
  const target = (h: (typeof loose)[number]): StockTarget => ({
    materialId: h.lot.materialId,
    materialName: h.lot.materialName,
    unit: h.lot.unit,
    max: h.quantity,
    fromProjectId: project.id,
    lotId: h.lot.id,
  });
  const markWaste = async (h: (typeof loose)[number]) => {
    const r = await registerUsage(project.id, {
      materialId: h.lot.materialId,
      materialName: h.lot.materialName,
      unit: h.lot.unit,
      consumed: 0,
      waste: h.quantity,
      lotId: h.lot.id,
      date: todayISO(),
      notes: "Desperdicio registrado al cerrar el proyecto",
    });
    if (!r.ok) setError(r.error);
  };
  // Simulamos el cierre para mostrar la rentabilidad real antes de confirmar.
  const simulated = useMemo(() => ({ ...project, status: "completed" as const }), [project]);
  const econ = useMemo(() => projectEconomics(simulated), [simulated]);
  const texts = useMemo(() => closingSummary(simulated), [simulated]);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setStep(0); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cerrar proyecto {project.code}</DialogTitle>
          <DialogDescription>Paso {step + 1} de 2 · {step === 0 ? "Destino del material" : "Resultado final"}</DialogDescription>
        </DialogHeader>
        {step === 0 ? (
          <div className="space-y-4">
            {loose.length === 0 ? (
              <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
                No queda material sin destino. Costo de materiales imputable: <strong>{formatCurrency(flow.attributableCost)}</strong> (consumido + desperdiciado).
              </p>
            ) : (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                <div className="flex items-center gap-2 font-medium">
                  <TriangleAlert className="size-4" /> Hay material asignado sin destino
                </div>
                <p className="mt-1">No se puede cerrar con material en el aire. Elegí qué pasó con cada uno:</p>
              </div>
            )}
            {loose.length > 0 && (
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                {loose.map((h) => (
                  <li key={h.lot.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <div className="min-w-48 flex-1">
                      <div className="font-medium text-slate-900">{h.lot.materialName}</div>
                      <div className="text-xs text-slate-500">{formatQty(h.quantity, h.lot.unit)} · {formatCurrency(h.quantity * h.lot.unitCost)}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setAct({ action: "release", target: target(h) })}>Volver al stock</Button>
                    <Button size="sm" variant="outline" onClick={() => setAct({ action: "transfer", target: target(h) })}>Otro proyecto</Button>
                    <Button size="sm" variant="outline" onClick={() => setAct({ action: "leftover", target: target(h) })}>Sobrante</Button>
                    <Button size="sm" variant="outline" onClick={() => setAct({ action: "supplier", target: target(h) })}>A proveedor</Button>
                    <Button size="sm" variant="ghost" className="text-red-700" onClick={() => markWaste(h)}>Desperdicio</Button>
                  </li>
                ))}
              </ul>
            )}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            {act && <StockActionDialog action={act.action} target={act.target} open onOpenChange={(o) => { if (!o) setAct(null); }} />}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Precio de venta" value={econ.hasSalesPrice ? formatCurrency(econ.salesPrice) : "—"} />
              <Kpi label="Costo presupuestado" value={formatCurrency(econ.budgetTotal)} />
              <Kpi label="Costo real final" value={formatCurrency(econ.actualCostToDate)} />
              <Kpi label="Ganancia esperada → real" value={econ.hasSalesPrice ? `${formatCurrencyOrDash(econ.expectedProfit)} → ${formatCurrencyOrDash(econ.finalProfit)}` : "—"} small />
            </div>
            <div className="flex flex-wrap items-end gap-6 rounded-lg bg-slate-50 p-4">
              <div>
                <div className="text-xs text-slate-500">Rentabilidad esperada</div>
                <div className="text-3xl font-semibold tabular">{formatPercent(econ.expectedMargin)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Rentabilidad real final</div>
                <div className="text-3xl font-semibold tabular">{formatPercent(econ.finalMargin)}</div>
              </div>
              <div className="pb-1 text-lg font-medium tabular text-slate-700">{formatMarginPoints(econ.marginDeltaPp, { signed: true })}</div>
            </div>
            {econ.categories.some((c) => c.budget > 0 && c.actual === 0) && (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                <div className="flex items-center gap-2 font-medium">
                  <TriangleAlert className="size-4" /> Categorías presupuestadas sin costos registrados
                </div>
                <p className="mt-1">
                  {econ.categories
                    .filter((c) => c.budget > 0 && c.actual === 0)
                    .map((c) => `${CATEGORY_LABELS[c.category]} (${formatCurrency(c.budget)})`)
                    .join(", ")}
                  . Si esos costos ya ocurrieron, registralos antes de cerrar: si no, la rentabilidad real va a quedar más alta de lo que fue.
                </p>
              </div>
            )}
            <div className="space-y-1 text-sm">
              <p className="font-medium text-slate-900">{texts.costText}</p>
              {texts.causeText && <p className="text-slate-700">{texts.causeText}</p>}
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Categoría</TH>
                  <TH className="text-right">Costo presupuestado</TH>
                  <TH className="text-right">Costo real final</TH>
                  <TH className="text-right">Desvío</TH>
                </TR>
              </THead>
              <TBody>
                {econ.categories.map((c) => (
                  <TR key={c.category}>
                    <TD>{CATEGORY_LABELS[c.category]}</TD>
                    <TD className="text-right tabular">{formatCurrency(c.budget)}</TD>
                    <TD className="text-right tabular">{formatCurrency(c.actual)}</TD>
                    <TD className={`text-right tabular ${c.actualVariance.amount > 0 ? "text-red-700" : "text-emerald-700"}`}>{formatSignedCurrency(c.actualVariance.amount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          {step === 0 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button disabled={loose.length > 0} onClick={() => setStep(1)}>Continuar</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(0)}>Atrás</Button>
              <Button
                onClick={async () => {
                  const r = await closeProject(project.id);
                  if (r.ok) onOpenChange(false);
                  else setError(r.error);
                }}
              >
                Confirmar cierre
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 font-semibold tabular ${small ? "text-sm" : "text-base"}`}>{value}</div>
    </div>
  );
}
