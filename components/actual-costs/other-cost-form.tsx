"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Project } from "@/types";
import { CATEGORY_LABELS } from "@/lib/constants";
import { actualInputCategory, type ActualInput } from "@/lib/project-operations";
import { otherCostSchema, type OtherCostValues } from "@/lib/schemas";
import { todayISO } from "@/lib/formatting";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

/** Costo real que no es material ni horas. `cost` dice el tipo y, para Diseño / Administración / Gasto financiero, la categoría. */
export function OtherCostForm({ project, cost, onDone }: { project: Project; cost: Pick<ActualInput, "type" | "category">; onDone: () => void }) {
  const addActualEntry = useConfirmedAction("addActualEntry");
  const { register, handleSubmit, setError, formState } = useForm<OtherCostValues>({
    resolver: zodResolver(otherCostSchema),
    defaultValues: { supplier: "", description: "", date: todayISO(), notes: "" },
  });
  const e = formState.errors;
  const category = actualInputCategory(cost);
  const submit = async (v: OtherCostValues) => {
    const res = await addActualEntry(project.id, {
      ...cost,
      description: v.description,
      amount: v.amount,
      supplier: v.supplier || undefined,
      date: v.date,
      notes: v.notes || undefined,
    });
    if (!res.ok) return setError("root", { message: res.error });
    onDone();
  };
  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4">
      <p className="text-sm text-slate-500">
        Se imputará en la categoría <strong>{CATEGORY_LABELS[category]}</strong>.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Descripción" htmlFor="o-desc" error={e.description?.message} className="col-span-2">
          <Input id="o-desc" {...register("description")} aria-invalid={!!e.description} />
        </Field>
        <Field label="Proveedor (opcional)" htmlFor="o-supplier">
          <Input id="o-supplier" {...register("supplier")} />
        </Field>
        <Field label="Monto (ARS)" htmlFor="o-amount" error={e.amount?.message}>
          <Input id="o-amount" type="number" step="any" min={0} {...register("amount", { valueAsNumber: true })} aria-invalid={!!e.amount} />
        </Field>
        <Field label="Fecha" htmlFor="o-date" error={e.date?.message}>
          <Input id="o-date" type="date" {...register("date")} />
        </Field>
      </div>
      <Field label="Notas" htmlFor="o-notes">
        <Textarea id="o-notes" rows={2} {...register("notes")} />
      </Field>
      {e.root && <p role="alert" className="text-sm text-red-600">{e.root.message}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancelar</Button>
        <Button type="submit">Registrar costo</Button>
      </DialogFooter>
    </form>
  );
}
