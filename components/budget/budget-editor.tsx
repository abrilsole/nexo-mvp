"use client";
import { Plus, Trash2 } from "lucide-react";
import type { BudgetCategory, BudgetLine, RubroId } from "@/types";
import { CATEGORY_LABELS, CATEGORY_ORDER, MATERIAL_CATALOG } from "@/lib/constants";
import { budgetLineTotal } from "@/lib/calculations";
import { formatCurrency } from "@/lib/formatting";
import { budgetLineSchema } from "@/lib/schemas";
import { isRubroId, RUBROS } from "@/lib/rubros";
import type { BudgetLineInput } from "@/lib/project-operations";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useCatalogPrice } from "@/store/selectors";

/** Fila en edición: los números como texto para permitir vacíos. quantity vacío = monto directo. */
export interface DraftLine {
  key: string;
  category: BudgetCategory;
  /** "" = sin rubro. */
  rubro: RubroId | "";
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
}

let k = 0;
function newDraftLine(category: BudgetCategory = "materials"): DraftLine {
  k += 1;
  return { key: `d${Date.now()}${k}`, category, rubro: "", description: "", quantity: "", unit: category === "materials" ? "placa" : category === "labor" ? "h" : "global", unitCost: "" };
}

export function draftFromLine(l: BudgetLine): DraftLine {
  return {
    key: l.id,
    category: l.category,
    rubro: l.rubro ?? "",
    description: l.description,
    quantity: l.quantity === null ? "" : String(l.quantity),
    unit: l.unit,
    unitCost: String(l.unitCost),
  };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export function draftToInput(d: DraftLine): { input?: BudgetLineInput; error?: string } {
  const cat = MATERIAL_CATALOG.find((m) => m.name.toLowerCase() === d.description.trim().toLowerCase());
  const candidate = {
    category: d.category,
    description: d.description.trim(),
    materialId: d.category === "materials" ? cat?.id : undefined,
    quantity: num(d.quantity),
    unit: d.quantity.trim() === "" ? "global" : d.unit.trim() || "u",
    unitCost: num(d.unitCost) ?? NaN,
  };
  const parsed = budgetLineSchema.safeParse(candidate);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revisá la fila" };
  return { input: { ...candidate, category: d.category, rubro: d.rubro || undefined } };
}

function draftTotal(d: DraftLine): number {
  const unitCost = num(d.unitCost);
  if (unitCost === null || Number.isNaN(unitCost)) return 0;
  const q = num(d.quantity);
  return budgetLineTotal({ quantity: q !== null && Number.isFinite(q) ? q : null, unitCost });
}

export function BudgetEditor({
  lines,
  onChange,
  errors = {},
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  errors?: Record<string, string>;
}) {
  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const catalogPrice = useCatalogPrice();
  return (
    <div>
      <datalist id="catalog-materials">
        {MATERIAL_CATALOG.map((m) => (
          <option key={m.id} value={m.name} />
        ))}
      </datalist>
      <Table>
        <THead>
          <TR>
            <TH>Rubro</TH>
            <TH>Categoría</TH>
            <TH>Descripción</TH>
            <TH className="text-right">Cantidad</TH>
            <TH>Unidad</TH>
            <TH className="text-right">Costo unitario / monto</TH>
            <TH className="text-right">Total</TH>
            <TH><span className="sr-only">Acciones</span></TH>
          </TR>
        </THead>
        <TBody>
          {lines.map((l, i) => (
            <TR key={l.key} className="align-top">
              <TD className="min-w-40">
                <label className="sr-only" htmlFor={`rubro-${l.key}`}>Rubro fila {i + 1}</label>
                <Select id={`rubro-${l.key}`} value={l.rubro} onChange={(e) => update(l.key, { rubro: isRubroId(e.target.value) ? e.target.value : "" })}>
                  <option value="">Sin rubro</option>
                  {RUBROS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </Select>
              </TD>
              <TD className="min-w-36">
                <label className="sr-only" htmlFor={`cat-${l.key}`}>Categoría fila {i + 1}</label>
                <Select id={`cat-${l.key}`} value={l.category} onChange={(e) => update(l.key, { category: e.target.value as BudgetCategory })}>
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </Select>
              </TD>
              <TD className="min-w-56">
                <label className="sr-only" htmlFor={`desc-${l.key}`}>Descripción fila {i + 1}</label>
                <Input
                  id={`desc-${l.key}`}
                  list={l.category === "materials" ? "catalog-materials" : undefined}
                  value={l.description}
                  placeholder={l.category === "materials" ? "Ej.: Melamina blanca 18 mm" : "Concepto"}
                  onChange={(e) => {
                    const cat = MATERIAL_CATALOG.find((m) => m.name === e.target.value);
                    update(l.key, { description: e.target.value, ...(cat ? { unit: cat.unit, unitCost: l.unitCost || String(catalogPrice(cat.id)) } : {}) });
                  }}
                  aria-invalid={!!errors[l.key]}
                />
                {errors[l.key] && <p role="alert" className="mt-1 text-xs text-red-600">{errors[l.key]}</p>}
              </TD>
              <TD className="w-28">
                <label className="sr-only" htmlFor={`qty-${l.key}`}>Cantidad fila {i + 1}</label>
                <Input id={`qty-${l.key}`} inputMode="decimal" className="text-right" placeholder="—" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
              </TD>
              <TD className="w-24">
                <label className="sr-only" htmlFor={`unit-${l.key}`}>Unidad fila {i + 1}</label>
                <Input id={`unit-${l.key}`} value={l.quantity.trim() === "" ? "global" : l.unit} disabled={l.quantity.trim() === ""} onChange={(e) => update(l.key, { unit: e.target.value })} />
              </TD>
              <TD className="w-40">
                <label className="sr-only" htmlFor={`cost-${l.key}`}>Costo fila {i + 1}</label>
                <Input id={`cost-${l.key}`} inputMode="decimal" className="text-right" placeholder="$" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} />
              </TD>
              <TD className="whitespace-nowrap pt-4 text-right font-medium tabular text-slate-900">{formatCurrency(draftTotal(l))}</TD>
              <TD className="w-10">
                <Button variant="ghost" size="icon" aria-label={`Quitar fila ${i + 1}`} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
                  <Trash2 />
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => onChange([...lines, newDraftLine(lines.at(-1)?.category ?? "materials")])}>
          <Plus /> Agregar concepto
        </Button>
        <p className="text-xs text-slate-500">Dejá la cantidad vacía para cargar un monto directo (ej.: flete global).</p>
      </div>
    </div>
  );
}
