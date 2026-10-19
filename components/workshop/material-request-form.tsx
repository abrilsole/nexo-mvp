"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo, useState } from "react";
import type { Project } from "@/types";
import { OTHER_MATERIAL_ID } from "@/lib/constants";
import { projectMaterialOptions } from "@/lib/material-options";
import { materialKey } from "@/lib/material-reconciliation";
import { parseDecimal } from "@/lib/schemas";
import { formatQty } from "@/lib/formatting";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { QuantityInput } from "./quantity-input";

/** "Solicitar material": el operario avisa qué falta. No mueve stock ni genera costo. */
export function MaterialRequestForm({ project, onDone }: { project: Project; onDone: (s: string) => void }) {
  const createMaterialRequest = useConfirmedAction("createMaterialRequest");
  const options = useMemo(() => projectMaterialOptions(project).filter((o) => o.inBudget), [project]);
  const [materialId, setMaterialId] = useState("");
  const [customName, setCustomName] = useState("");
  const [customUnit, setCustomUnit] = useState("u");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isOther = materialId === OTHER_MATERIAL_ID;
  const selected = options.find((o) => o.id === materialId);
  const unit = isOther ? customUnit.trim() || "u" : selected?.unit ?? "u";

  const submit = async () => {
    const e: Record<string, string> = {};
    const q = parseDecimal(qty || "0");
    if (!materialId) e.material = "Elegí un material";
    if (isOther && customName.trim().length < 2) e.customName = "Escribí el nombre del material";
    if (!(q > 0)) e.qty = "Indicá cuánto necesitás";
    setErrors(e);
    if (Object.keys(e).length) return;
    const name = isOther ? customName.trim() : selected!.name;
    const res = await createMaterialRequest({
      projectId: project.id,
      materialId: isOther ? materialKey(undefined, customName) : materialId,
      materialName: name,
      unit,
      quantity: q,
      note,
    });
    if (!res.ok) return setErrors({ form: res.error });
    onDone(`Pediste ${formatQty(q, unit)} de ${name}. Administrativo lo va a ver.`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Solicitar material</h1>
      <div>
        <label htmlFor="mr-material" className="mb-1.5 block text-base font-medium">¿Qué material?</label>
        <Select id="mr-material" className="h-12 text-base" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">Elegí un material…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value={OTHER_MATERIAL_ID}>Otro material</option>
        </Select>
        {errors.material && <p role="alert" className="mt-1 text-sm text-red-600">{errors.material}</p>}
      </div>
      {isOther && (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label htmlFor="mr-custom" className="mb-1.5 block text-sm font-medium">Nombre</label>
            <Input id="mr-custom" className="h-12 text-base" value={customName} onChange={(e) => setCustomName(e.target.value)} />
            {errors.customName && <p role="alert" className="mt-1 text-sm text-red-600">{errors.customName}</p>}
          </div>
          <div>
            <label htmlFor="mr-unit" className="mb-1.5 block text-sm font-medium">Unidad</label>
            <Input id="mr-unit" className="h-12 text-base" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)} />
          </div>
        </div>
      )}
      {materialId && <QuantityInput id="mr-qty" label="Cantidad que falta" value={qty} onChange={setQty} unit={unit} error={errors.qty} />}
      <div>
        <label htmlFor="mr-note" className="mb-1.5 block text-sm font-medium">Comentario (opcional)</label>
        <Input id="mr-note" className="h-12 text-base" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {errors.form && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{errors.form}</p>}
      <Button size="xl" className="w-full" onClick={submit}>Enviar pedido</Button>
    </div>
  );
}
