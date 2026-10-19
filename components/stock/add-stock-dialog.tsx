"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useState } from "react";
import { MATERIAL_CATALOG, OTHER_MATERIAL_ID } from "@/lib/constants";
import { parseDecimal } from "@/lib/schemas";
import { todayISO } from "@/lib/formatting";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";

type Kind = "purchase" | "opening";

/**
 * Ingresar stock al depósito: el material queda LIBRE (Disponible), no asignado a un proyecto.
 * "Registrar compra" queda solo dentro del proyecto (etapa Compras). Opción secundaria: inventario inicial (material que ya tenías). En ningún caso es costo de un proyecto
 * hasta que se asigne y se consuma: compra ≠ costo.
 */
export function AddStockDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const addStockLot = useConfirmedAction("addStockLot");
  const [kind, setKind] = useState<Kind>("purchase");
  const [materialId, setMaterialId] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [location, setLocation] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setKind("purchase"); setMaterialId(""); setName(""); setUnit(""); setQty(""); setCost(""); setSupplier(""); setLocation(""); setErrors({});
  };

  const pick = (id: string) => {
    setMaterialId(id);
    const m = MATERIAL_CATALOG.find((x) => x.id === id);
    if (m) {
      setUnit(m.unit);
      if (!cost) setCost(String(m.referenceCost));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    const custom = materialId === OTHER_MATERIAL_ID;
    if (!materialId) err.material = "Elegí un material.";
    if (custom && !name.trim()) err.name = "Poné el nombre del material.";
    if (!unit.trim()) err.unit = "Indicá la unidad.";
    const q = parseDecimal(qty);
    const c = parseDecimal(cost);
    if (!(q > 0)) err.qty = "La cantidad debe ser mayor a 0.";
    if (!(c > 0)) err.cost = "El costo unitario debe ser mayor a 0: el stock conserva su costo original.";
    setErrors(err);
    if (Object.keys(err).length) return;
    const cat = MATERIAL_CATALOG.find((m) => m.id === materialId);
    const res = await addStockLot({
      ...(custom ? {} : { materialId }),
      materialName: custom ? name.trim() : (cat?.name ?? name),
      unit: unit.trim(),
      quantity: q,
      unitCost: c,
      ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      date: todayISO(),
      kind,
    });
    if (!res.ok) {
      setErrors({ form: res.error });
      return;
    }
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent side="right">
        <DialogHeader>
          <DialogTitle>{kind === "purchase" ? "Ingresar stock" : "Cargar inventario inicial"}</DialogTitle>
          <DialogDescription>
            {kind === "purchase"
              ? "Material comprado que entra al depósito, sin proyecto: queda disponible para asignar a cualquiera. Todavía no es costo: lo es recién cuando se consume. Para comprar para un proyecto, usá “Registrar compra” dentro del proyecto."
              : "Material que ya tenías en el depósito antes de usar la app. Queda disponible con el costo que le pongas; no es una compra ni costo de ningún proyecto."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Material" htmlFor="as-material" error={errors.material}>
            <Select id="as-material" value={materialId} onChange={(e) => pick(e.target.value)}>
              <option value="">Elegí un material…</option>
              {MATERIAL_CATALOG.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
              <option value={OTHER_MATERIAL_ID}>Otro material</option>
            </Select>
          </Field>
          {materialId === OTHER_MATERIAL_ID && (
            <Field label="Nombre del material" htmlFor="as-name" error={errors.name}>
              <Input id="as-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cantidad" htmlFor="as-qty" error={errors.qty}>
              <Input id="as-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Unidad" htmlFor="as-unit" error={errors.unit}>
              <Input id="as-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
          </div>
          <Field label="Costo unitario ($)" htmlFor="as-cost" error={errors.cost}>
            <Input id="as-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <Field label={kind === "purchase" ? "Proveedor" : "Proveedor (opcional)"} htmlFor="as-supplier">
            <Input id="as-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="Ubicación (opcional)" htmlFor="as-location">
            <Input id="as-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ej.: Depósito, estante B" />
          </Field>
          {errors.form && <p role="alert" className="text-sm text-red-600">{errors.form}</p>}
          <p className="text-sm text-slate-500">
            {kind === "purchase" ? (
              <>
                ¿No es una compra, sino material que ya tenías?{" "}
                <button type="button" className="font-medium text-blue-700 underline" onClick={() => setKind("opening")}>Cargarlo como inventario inicial</button>
              </>
            ) : (
              <button type="button" className="font-medium text-blue-700 underline" onClick={() => setKind("purchase")}>Volver a ingresar stock comprado</button>
            )}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit">{kind === "purchase" ? "Ingresar stock" : "Cargar inventario inicial"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
