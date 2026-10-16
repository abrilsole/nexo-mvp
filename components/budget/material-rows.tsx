"use client";
// Filas de materiales de una cotización: descripción (con el catálogo), cantidad, unidad, costo unitario y desperdicio.
// La usan un rubro del Cotizador y el Cotizador de materiales de Compras (Lote 5C).
import { Plus } from "lucide-react";
import { MATERIAL_CATALOG } from "@/lib/constants";
import { materialBudgetQuantity } from "@/lib/budget-calculator";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import { parseDecimal } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { useCatalogPrice } from "@/store/selectors";
import { NumField, RemoveButton, TextField } from "./fields";
import { newMaterialRow, type MaterialRow } from "./calculator-state";

/** Id del datalist con el catálogo de materiales: va una sola vez por pantalla (MaterialCatalogList). */
const CATALOG_LIST = "calc-catalog";

export function MaterialCatalogList() {
  return (
    <datalist id={CATALOG_LIST}>
      {MATERIAL_CATALOG.map((m) => (
        <option key={m.id} value={m.name} />
      ))}
    </datalist>
  );
}

const num = (s: string) => {
  const v = parseDecimal(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** `owner`: de qué son los materiales (nombre del rubro), para las etiquetas accesibles. */
export function MaterialRows({ materials, onChange, owner }: { materials: MaterialRow[]; onChange: (materials: MaterialRow[]) => void; owner: string }) {
  const catalogPrice = useCatalogPrice();
  const setMaterial = (key: string, patch: Partial<MaterialRow>) => onChange(materials.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Materiales
          <HelpTip label="Materiales">
            Cantidad × costo unitario, más el desperdicio esperado. Para algo que se compra hecho o se corta, alcanza con cantidad 1 y el costo total.
          </HelpTip>
        </h4>
        <Button variant="outline" size="sm" onClick={() => onChange([...materials, newMaterialRow()])}>
          <Plus /> Material
        </Button>
      </div>
      <div className="space-y-2">
        {materials.map((m, i) => (
          <div key={m.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_0.8fr_0.8fr_1fr_0.8fr_auto]">
            <div className="col-span-2 sm:col-span-1">
              <TextField
                id={`m-name-${m.key}`}
                label="Descripción"
                list={CATALOG_LIST}
                value={m.name}
                placeholder="Ej.: Melamina blanca 18 mm"
                onChange={(v) => {
                  const cat = MATERIAL_CATALOG.find((c) => c.name === v);
                  setMaterial(m.key, { name: v, ...(cat ? { unit: cat.unit, unitCost: m.unitCost || String(catalogPrice(cat.id)) } : {}) });
                }}
              />
            </div>
            <NumField id={`m-qty-${m.key}`} label="Cantidad" value={m.quantity} onChange={(v) => setMaterial(m.key, { quantity: v })} />
            <TextField id={`m-unit-${m.key}`} label="Unidad" value={m.unit} onChange={(v) => setMaterial(m.key, { unit: v })} />
            <NumField id={`m-cost-${m.key}`} label="Costo unitario" suffix="$" value={m.unitCost} onChange={(v) => setMaterial(m.key, { unitCost: v })} />
            <NumField id={`m-waste-${m.key}`} label="Desperdicio" suffix="%" value={m.wastePct} onChange={(v) => setMaterial(m.key, { wastePct: v })} />
            <RemoveButton label={`Quitar material ${i + 1} de ${owner}`} onClick={() => onChange(materials.filter((x) => x.key !== m.key))} />
            {num(m.quantity) > 0 && num(m.unitCost) > 0 && (
              <p className="col-span-2 text-right text-xs text-slate-500 tabular sm:col-span-6">
                {formatNumber(materialBudgetQuantity({ quantity: num(m.quantity), wastePct: num(m.wastePct) }), 2)} {m.unit || "u"} × {formatCurrency(num(m.unitCost))} ={" "}
                {formatCurrency(materialBudgetQuantity({ quantity: num(m.quantity), wastePct: num(m.wastePct) }) * num(m.unitCost))}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
