"use client";
// Un rubro de la cotización: materiales, operarios × horas por operario, horas de diseño y de administración
// (o solo un importe en Transporte / Fletes e Imprevistos). El desglose muestra de dónde sale cada importe.
import { Plus } from "lucide-react";
import { MATERIAL_CATALOG } from "@/lib/constants";
import { materialBudgetQuantity, type HourCharge } from "@/lib/budget-calculator";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import { rubroDef } from "@/lib/rubros";
import { parseDecimal } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { NumField, RemoveButton, TextField } from "./fields";
import { newMaterialRow, type MaterialRow, type RubroResult, type RubroRow } from "./calculator-state";

const h = (n: number) => `${formatNumber(n, 2)} h`;
const num = (s: string) => {
  const v = parseDecimal(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

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
  const setMaterial = (key: string, patch: Partial<MaterialRow>) =>
    onChange({ materials: row.materials.map((m) => (m.key === key ? { ...m, ...patch } : m)) });

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
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Materiales
                <HelpTip label="Materiales">
                  Cantidad × costo unitario, más el desperdicio esperado. Para algo que se compra hecho o se corta, alcanza con cantidad 1 y el costo total.
                </HelpTip>
              </h4>
              <Button variant="outline" size="sm" onClick={() => onChange({ materials: [...row.materials, newMaterialRow()] })}>
                <Plus /> Material
              </Button>
            </div>
            <div className="space-y-2">
              {row.materials.map((m, i) => (
                <div key={m.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_0.8fr_0.8fr_1fr_0.8fr_auto]">
                  <div className="col-span-2 sm:col-span-1">
                    <TextField
                      id={`m-name-${m.key}`}
                      label="Descripción"
                      list="calc-catalog"
                      value={m.name}
                      placeholder="Ej.: Melamina blanca 18 mm"
                      onChange={(v) => {
                        const cat = MATERIAL_CATALOG.find((c) => c.name === v);
                        setMaterial(m.key, { name: v, ...(cat ? { unit: cat.unit, unitCost: m.unitCost || String(cat.referenceCost) } : {}) });
                      }}
                    />
                  </div>
                  <NumField id={`m-qty-${m.key}`} label="Cantidad" value={m.quantity} onChange={(v) => setMaterial(m.key, { quantity: v })} />
                  <TextField id={`m-unit-${m.key}`} label="Unidad" value={m.unit} onChange={(v) => setMaterial(m.key, { unit: v })} />
                  <NumField id={`m-cost-${m.key}`} label="Costo unitario" suffix="$" value={m.unitCost} onChange={(v) => setMaterial(m.key, { unitCost: v })} />
                  <NumField id={`m-waste-${m.key}`} label="Desperdicio" suffix="%" value={m.wastePct} onChange={(v) => setMaterial(m.key, { wastePct: v })} />
                  <RemoveButton label={`Quitar material ${i + 1} de ${def.label}`} onClick={() => onChange({ materials: row.materials.filter((x) => x.key !== m.key) })} />
                  {num(m.quantity) > 0 && num(m.unitCost) > 0 && (
                    <p className="col-span-2 text-right text-xs text-slate-500 tabular sm:col-span-6">
                      {formatNumber(materialBudgetQuantity({ quantity: num(m.quantity), wastePct: num(m.wastePct) }), 2)} {m.unit || "u"} ×{" "}
                      {formatCurrency(num(m.unitCost))} ={" "}
                      {formatCurrency(materialBudgetQuantity({ quantity: num(m.quantity), wastePct: num(m.wastePct) }) * num(m.unitCost))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

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
