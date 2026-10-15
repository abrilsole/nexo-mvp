"use client";
// Corrección auditada de un valor congelado (Lote 5A): precio de venta, o cantidad / costo unitario de una
// línea del costo presupuestado. Queda registrado quién, cuándo, valor anterior, nuevo y motivo.
import { useState } from "react";
import { History, PencilLine } from "lucide-react";
import type { Project, ValueCorrection } from "@/types";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/formatting";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Option = { key: string; label: string; target: ValueCorrection["target"]; field: ValueCorrection["field"]; lineId?: string; current: number | null };

function optionsOf(project: Project): Option[] {
  const out: Option[] = [{ key: "price", label: "Precio de venta", target: "sales_price", field: "sales_price", current: project.salesPrice }];
  for (const l of project.budgetLines) {
    if (l.quantity !== null) out.push({ key: `${l.id}:q`, label: `${l.description} — cantidad`, target: "budget_line", field: "quantity", lineId: l.id, current: l.quantity });
    out.push({ key: `${l.id}:c`, label: `${l.description} — ${l.quantity === null ? "monto" : "costo unitario"}`, target: "budget_line", field: "unit_cost", lineId: l.id, current: l.unitCost });
  }
  return out;
}

const show = (field: ValueCorrection["field"], v: number | null) => (v === null ? "—" : field === "quantity" ? formatNumber(v) : formatCurrency(v));

export function CorrectionButton({ project }: { project: Project }) {
  const correctValue = useAppStore((s) => s.correctValue);
  const [open, setOpen] = useState(false);
  const options = optionsOf(project);
  const [key, setKey] = useState(options[0].key);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const option = options.find((o) => o.key === key) ?? options[0];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await correctValue(project.id, { target: option.target, field: option.field, lineId: option.lineId, newValue: parseDecimal(value), reason });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    setValue("");
    setReason("");
    setError("");
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PencilLine /> Corregir un valor
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Corregir un valor congelado</DialogTitle>
            <DialogDescription>
              El precio de venta y el costo presupuestado quedaron congelados al aprobar el proyecto. Una corrección cambia el valor y deja registrado quién la
              hizo, cuándo, el valor anterior, el nuevo y el motivo.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Qué corregir" htmlFor="cor-what">
              <Select id="cor-what" value={key} onChange={(e) => setKey(e.target.value)}>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-slate-600">
              Valor actual: <strong className="tabular">{show(option.field, option.current)}</strong>
            </p>
            <Field label="Valor correcto" htmlFor="cor-value">
              <Input id="cor-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <Field label="Motivo" htmlFor="cor-reason">
              <Textarea id="cor-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por ejemplo: el cliente aceptó un descuento" />
            </Field>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar corrección"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Correcciones registradas del proyecto (más nueva primero). */
export function CorrectionsList({ projectId }: { projectId: string }) {
  const all = useAppStore((s) => s.corrections);
  const list = all.filter((c) => c.projectId === projectId).sort((a, b) => b.correctedAt.localeCompare(a.correctedAt));
  if (list.length === 0) return null;
  return (
    <section aria-label="Correcciones registradas" className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <History className="size-4 text-slate-400" aria-hidden /> Correcciones registradas
      </h3>
      <ul className="space-y-2 text-sm">
        {list.map((c) => (
          <li key={c.id} className="text-slate-700">
            <span className="font-medium">{c.description}</span>
            {c.field === "quantity" ? " (cantidad)" : c.target === "budget_line" ? " (costo)" : ""}: {show(c.field, c.oldValue)} → {show(c.field, c.newValue)}. Motivo: {c.reason}
            <span className="block text-xs text-slate-500">
              {c.correctedBy} · {formatDateTime(c.correctedAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
