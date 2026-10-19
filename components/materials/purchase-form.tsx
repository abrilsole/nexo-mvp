"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";
import type { Project } from "@/types";
import { OTHER_MATERIAL_ID } from "@/lib/constants";
import { projectMaterialOptions, suggestUnitCost } from "@/lib/material-options";
import { purchaseSchema, type PurchaseValues } from "@/lib/schemas";
import { formatCurrency, todayISO } from "@/lib/formatting";
import { slugify } from "@/lib/material-reconciliation";
import { useAppStore } from "@/store/use-app-store";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { MaterialSelect } from "./material-select";

export const PURCHASE_NOTICE =
  "El material comprado queda asignado a este proyecto, pero todavía no es costo: el costo real se calcula con lo que se consume y se desperdicia. Lo que sobre puede volver al stock o ir a otro proyecto.";

export function PurchaseForm({
  project,
  onDone,
  prefill,
}: {
  project: Project;
  onDone: () => void;
  /** Para comprar lo que falta de un material desde la pestaña Materiales. */
  prefill?: { materialId: string; quantity: number };
}) {
  const addPurchaseEntry = useConfirmedAction("addPurchaseEntry");
  const lots = useAppStore((s) => s.stock.lots);
  const options = useMemo(() => projectMaterialOptions(project), [project]);
  const { register, handleSubmit, control, setValue, setError, formState } = useForm<PurchaseValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      materialId: prefill?.materialId ?? "",
      customName: "",
      unit: options.find((o) => o.id === prefill?.materialId)?.unit ?? "",
      quantity: prefill?.quantity,
      unitCost: prefill ? suggestUnitCost(project, lots, prefill.materialId) || undefined : undefined,
      date: todayISO(),
      supplier: "",
      notes: "",
    },
  });
  const materialId = useWatch({ control, name: "materialId" });
  const qty = Number(useWatch({ control, name: "quantity" })) || 0;
  const cost = Number(useWatch({ control, name: "unitCost" })) || 0;
  const e = formState.errors;

  const onMaterial = (id: string) => {
    setValue("materialId", id, { shouldValidate: true });
    const o = options.find((x) => x.id === id);
    if (o) {
      setValue("unit", o.unit);
      const unitCost = suggestUnitCost(project, lots, o.id);
      if (unitCost > 0) setValue("unitCost", unitCost);
    }
  };

  const submit = async (v: PurchaseValues) => {
    const isOther = v.materialId === OTHER_MATERIAL_ID;
    const o = options.find((x) => x.id === v.materialId);
    const res = await addPurchaseEntry(project.id, {
      materialId: isOther ? `custom:${slugify(v.customName ?? "")}` : v.materialId,
      materialName: isOther ? (v.customName ?? "").trim() : o?.name ?? v.materialId,
      quantity: v.quantity,
      unit: v.unit,
      unitCost: v.unitCost,
      supplier: v.supplier || undefined,
      date: v.date,
      notes: v.notes || undefined,
    });
    if (!res.ok) return setError("root", { message: res.error });
    onDone();
  };

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4">
      <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="note">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {PURCHASE_NOTICE}
      </div>
      <Field label="Material" htmlFor="p-material" error={e.materialId?.message}>
        <MaterialSelect id="p-material" options={options} value={materialId} onChange={(ev) => onMaterial(ev.target.value)} aria-invalid={!!e.materialId} />
      </Field>
      {materialId === OTHER_MATERIAL_ID && (
        <Field label="Nombre del material" htmlFor="p-custom" error={e.customName?.message}>
          <Input id="p-custom" {...register("customName")} />
        </Field>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Cantidad" htmlFor="p-qty" error={e.quantity?.message}>
          <Input id="p-qty" type="number" step="any" min={0} {...register("quantity", { valueAsNumber: true })} aria-invalid={!!e.quantity} />
        </Field>
        <Field label="Unidad" htmlFor="p-unit" error={e.unit?.message}>
          <Input id="p-unit" {...register("unit")} />
        </Field>
        <Field label="Costo unitario" htmlFor="p-cost" error={e.unitCost?.message}>
          <Input id="p-cost" type="number" step="any" min={0} {...register("unitCost", { valueAsNumber: true })} aria-invalid={!!e.unitCost} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Proveedor (opcional)" htmlFor="p-supplier">
          <Input id="p-supplier" {...register("supplier")} />
        </Field>
        <Field label="Fecha" htmlFor="p-date" error={e.date?.message}>
          <Input id="p-date" type="date" {...register("date")} />
        </Field>
      </div>
      <Field label="Notas" htmlFor="p-notes">
        <Textarea id="p-notes" rows={2} {...register("notes")} />
      </Field>
      <div className="rounded-md bg-slate-50 p-3 text-sm">
        Total compra: <strong className="tabular">{formatCurrency(qty * cost)}</strong>
        <span className="text-slate-500"> · Impacto en el costo del proyecto: <strong>$ 0</strong> hasta que se consuma</span>
      </div>
      {e.root && <p role="alert" className="text-sm text-red-600">{e.root.message}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancelar</Button>
        <Button type="submit">Registrar compra</Button>
      </DialogFooter>
    </form>
  );
}
