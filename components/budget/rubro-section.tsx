"use client";
// Un rubro de la cotización: materiales, operarios × horas por operario, horas de diseño y de administración
// (o solo un importe en Transporte / Fletes e Imprevistos). El desglose muestra de dónde sale cada importe.
import type { HourCharge } from "@/lib/budget-calculator";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import { rubroDef } from "@/lib/rubros";
import { NumField, RemoveButton } from "./fields";
import { MaterialRows } from "./material-rows";
import type { RubroResult, RubroRow } from "./calculator-state";

const h = (n: number) => `${formatNumber(n, 2)} h`;

export function RubroSection({
  row,
  result,
  onChange,
  onRemove,
}: {
  row: RubroRow;
  result: RubroResult | undefined;
  onChange: (patch: Partial<RubroRow>) => void;
  onRemove: () => void;
}) {
  const def = rubroDef(row.rubro);
  const labor = result?.labor ?? null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby={`rubro-${row.key}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 id={`rubro-${row.key}`} className="text-sm font-semibold text-slate-900">{def.label}</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium tabular text-slate-800">{formatCurrency(result?.total ?? 0)}</span>
          <RemoveButton label={`Quitar rubro ${def.label}`} onClick={onRemove} />
        </div>
      </div>

      {def.kind === "amount" ? (
        <div className="max-w-xs">
          <NumField id={`amt-${row.key}`} label="Importe" suffix="$" value={row.amount} onChange={(v) => onChange({ amount: v })} />
        </div>
      ) : (
        <div className="space-y-4">
          <MaterialRows materials={row.materials} onChange={(materials) => onChange({ materials })} owner={def.label} />

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Mano de obra</h4>
            <div className="grid max-w-md grid-cols-2 gap-2">
              <NumField id={`w-${row.key}`} label="Operarios" value={row.workers} onChange={(v) => onChange({ workers: v })} />
              <NumField id={`hpw-${row.key}`} label="Horas por operario" suffix="h" value={row.hoursPerWorker} onChange={(v) => onChange({ hoursPerWorker: v })} />
            </div>
            {labor && labor.workers > 0 && labor.hoursPerWorker > 0 && (
              <p className="mt-1 text-xs text-slate-600 tabular">
                {labor.workers} × {h(labor.hoursPerWorker)} = {h(labor.normalHours + labor.overtimeHours)}: {h(labor.normalHours)} normales ×{" "}
                {formatCurrency(labor.rate)} = {formatCurrency(labor.normalCost)}
                {labor.overtimeHours > 0 && (
                  <>
                    {" "}+ <strong className="text-amber-800">{h(labor.overtimeHours)} extra</strong> × {formatCurrency(labor.overtimeRate)} ={" "}
                    {formatCurrency(labor.overtimeCost)}
                  </>
                )}
              </p>
            )}
          </div>

          <div className="grid max-w-md grid-cols-2 gap-2">
            <FlatHours id={`dis-${row.key}`} title="Diseño" value={row.designHours} charge={labor?.design} onChange={(v) => onChange({ designHours: v })} />
            <FlatHours id={`adm-${row.key}`} title="Administración" value={row.adminHours} charge={labor?.admin} onChange={(v) => onChange({ adminHours: v })} />
          </div>
        </div>
      )}
    </section>
  );
}

/** Horas de diseño o de administración: horas totales × su tarifa (sin horas extra). */
function FlatHours({ id, title, value, charge, onChange }: { id: string; title: string; value: string; charge: HourCharge | undefined; onChange: (v: string) => void }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <NumField id={id} label={`Horas de ${title.toLowerCase()}`} suffix="h" value={value} onChange={onChange} />
      {charge && charge.hours > 0 && (
        <p className="mt-1 text-xs text-slate-600 tabular">
          {h(charge.hours)} × {formatCurrency(charge.rate)} = {formatCurrency(charge.cost)}
        </p>
      )}
    </div>
  );
}
