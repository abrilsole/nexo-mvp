"use client";
// Registrar una compra real: proveedor, precio realmente pagado, fecha y cantidad de cada proyecto.
// Sirve para una línea o para el mismo material de varios proyectos (vista consolidada: se compra una sola vez).
import { useMemo, useState } from "react";
import { formatCurrency, formatQty, todayISO } from "@/lib/formatting";
import { purchaseHistory, supplierPrices, type PurchaseLine } from "@/lib/purchasing";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RecordPurchaseDialog({ lines, onClose }: { lines: PurchaseLine[] | null; onClose: () => void }) {
  return (
    <Dialog open={lines !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{lines && lines.length > 0 && <PurchaseForm key={lines.map((l) => l.lineId).join(",")} lines={lines} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

const asText = (n: number) => (n > 0 ? String(n).replace(".", ",") : "");

function PurchaseForm({ lines, onClose }: { lines: PurchaseLine[]; onClose: () => void }) {
  const projects = useAppStore((s) => s.projects);
  const stock = useAppStore((s) => s.stock);
  const recordPurchase = useAppStore((s) => s.recordPurchase);
  const first = lines[0];
  // Sugerencia: el proveedor con el último precio más barato de este material; si no, el costo presupuestado.
  const best = useMemo(() => supplierPrices(purchaseHistory(projects, stock)).find((m) => m.key === first.key)?.suppliers[0], [projects, stock, first.key]);
  const [supplier, setSupplier] = useState(best?.supplier ?? "");
  const [price, setPrice] = useState(asText(best?.lastPrice ?? first.budgetUnitCost));
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.lineId, asText(l.remaining)])));
  const [error, setError] = useState("");
  const unitCost = parseDecimal(price);
  const total = lines.reduce((s, l) => s + (parseDecimal(qty[l.lineId] ?? "") || 0), 0) * (unitCost || 0);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const r = recordPurchase({
      materialId: first.materialId,
      materialName: first.description,
      unit: first.unit,
      supplier,
      unitCost,
      date,
      parts: lines.map((l) => ({ projectId: l.projectId, lineId: l.lineId, quantity: parseDecimal(qty[l.lineId] ?? "") || 0 })),
    });
    if (!r.ok) return setError(r.error);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Registrar compra · {first.description}</DialogTitle>
        <DialogDescription>
          Queda como compra real con el precio que pagaste ese día (no cambia el costo presupuestado). La línea pasa a &quot;Comprado&quot;.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={save} noValidate className="space-y-4">
        <Field label="Proveedor" htmlFor="rp-supplier">
          <Input id="rp-supplier" list="rp-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <SupplierOptions />
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Precio pagado por ${first.quantity === null ? "el total" : first.unit || "unidad"}`} htmlFor="rp-price">
            <Input id="rp-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Fecha" htmlFor="rp-date">
            <Input id="rp-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Presupuestado: {formatCurrency(first.budgetUnitCost)} por {first.quantity === null ? "el total" : first.unit || "unidad"}.
          {best && ` Último precio de ${best.supplier}: ${formatCurrency(best.lastPrice)}.`}
        </p>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Cantidad comprada</legend>
          {lines.map((l) => (
            <div key={l.lineId} className="grid grid-cols-[1fr_8rem] items-center gap-2">
              <label htmlFor={`rp-q-${l.lineId}`} className="min-w-0 break-words text-sm text-slate-700">
                <strong>{l.projectCode}</strong> · falta {formatQty(l.remaining, l.unit)}
              </label>
              <Input id={`rp-q-${l.lineId}`} inputMode="decimal" value={qty[l.lineId] ?? ""} onChange={(e) => setQty({ ...qty, [l.lineId]: e.target.value })} />
            </div>
          ))}
        </fieldset>
        {total > 0 && <p className="text-sm text-slate-700">Total de la compra: <strong className="tabular">{formatCurrency(total)}</strong></p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit">Registrar compra</Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** Proveedores ya usados, para elegir sin tipear. */
function SupplierOptions() {
  const projects = useAppStore((s) => s.projects);
  const stock = useAppStore((s) => s.stock);
  const names = useMemo(() => [...new Set(purchaseHistory(projects, stock).map((r) => r.supplier))].sort(), [projects, stock]);
  return (
    <datalist id="rp-suppliers">
      {names.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  );
}
