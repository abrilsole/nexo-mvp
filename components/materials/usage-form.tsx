"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo, useState } from "react";
import { PackageX } from "lucide-react";
import type { Project } from "@/types";
import { materialGroups, type MaterialGroup } from "@/lib/material-groups";
import { dimFieldsForUnit, formatDims, parseDims, type DimsDraft } from "@/lib/material-kinds";
import { parseDecimal } from "@/lib/schemas";
import { formatCurrency, formatQty, todayISO } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Input, Select } from "@/components/ui/input";
import { QuantityInput } from "@/components/workshop/quantity-input";
import { LeftoverDimsFields } from "@/components/stock/leftover-dims-fields";
import { cn } from "@/lib/utils";

type Variant = "workshop" | "management";

function YesNo({ label, value, onChange, big }: { label: string; value: boolean; onChange: (v: boolean) => void; big: boolean }) {
  return (
    <fieldset>
      <legend className={cn("mb-1.5 font-medium text-slate-800", big ? "text-base" : "text-sm")}>{label}</legend>
      <Choice<"no" | "si">
        name={label}
        size={big ? "lg" : "default"}
        value={value ? "si" : "no"}
        onChange={(v) => onChange(v === "si")}
        options={[
          { value: "no", label: "No" },
          { value: "si", label: "Sí" },
        ]}
      />
    </fieldset>
  );
}

const num = (v: string) => {
  const n = parseDecimal(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Registro de material usado. SOLO se ofrece lo que el proyecto tiene asignado
 * (comprado, tomado del stock o transferido): no se puede inventar ni pasarse de lo asignado.
 * Consumo y desperdicio son costo; el sobrante conserva su valor. Se muestran separados.
 */
export function UsageForm({
  project,
  onDone,
  variant,
  onRequestMaterial,
}: {
  project: Project;
  onDone: (summary: string) => void;
  variant: Variant;
  /** Taller: abre el pedido de material cuando no hay nada asignado. */
  onRequestMaterial?: () => void;
}) {
  const big = variant === "workshop";
  const stock = useAppStore((s) => s.stock);
  const registerUsage = useConfirmedAction("registerUsage");
  const groups = useMemo(() => materialGroups(stock, project.id), [stock, project.id]);

  const [materialId, setMaterialId] = useState("");
  const [lotId, setLotId] = useState("");
  const [used, setUsed] = useState("");
  const [hasWaste, setHasWaste] = useState(false);
  const [waste, setWaste] = useState("");
  const [hasLeftover, setHasLeftover] = useState(false);
  const [leftover, setLeftover] = useState("");
  const [dims, setDims] = useState<DimsDraft>({});
  const [location, setLocation] = useState("");
  const [itemId, setItemId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");

  const group: MaterialGroup | undefined = groups.find((g) => g.materialId === materialId);
  const lot = group?.lots.find((l) => l.lot.id === lotId);
  const available = lot ? lot.quantity : group?.quantity ?? 0;
  const unit = group?.unit ?? "u";
  const usedN = num(used);
  const wasteN = hasWaste ? num(waste) : 0;
  const leftoverN = hasLeftover ? num(leftover) : 0;
  const total = usedN + wasteN + leftoverN;
  const over = group ? total - available > 1e-6 : false;
  // Costo estimado según los lotes que se usarían (sólo Gestión lo ve).
  const unitCost = lot ? lot.lot.unitCost : group ? group.lots.reduce((s, l) => s + l.quantity * l.lot.unitCost, 0) / Math.max(group.quantity, 1e-9) : 0;

  const submit = async () => {
    if (!group) return setError("Elegí un material.");
    if (usedN + wasteN <= 0 && leftoverN <= 0) return setError("Indicá cuánto usaste.");
    if (hasWaste && wasteN <= 0) return setError("Indicá cuánto se desperdició.");
    if (hasLeftover && leftoverN <= 0) return setError("Indicá cuánto quedó reutilizable.");
    if (over) return setError(`Solo hay ${formatQty(available, unit)} de ${group.name} para este proyecto.`);
    const parsed = hasLeftover ? parseDims(dimFieldsForUnit(unit), dims) : { dims: undefined, error: undefined };
    if (parsed.error) return setError(parsed.error);
    if (usedN + wasteN <= 0) {
      // Sólo sobrante: no hay consumo; se marca desde la pestaña de materiales.
      return setError("Registrá también cuánto usaste. Para devolver material sin usarlo, usá las acciones de la pestaña Materiales.");
    }
    const res = await registerUsage(project.id, {
      materialId: group.materialId,
      materialName: group.name,
      unit,
      consumed: usedN,
      waste: wasteN,
      lotId: lotId || undefined,
      itemId: itemId || undefined,
      date,
      leftover: hasLeftover ? { quantity: leftoverN, dims: parsed.dims, location: location.trim() || undefined } : undefined,
    });
    if (!res.ok) return setError(res.error);
    const parts = [`${formatQty(usedN, unit)} de ${group.name}`];
    if (wasteN) parts.push(`${formatQty(wasteN, unit)} de desperdicio`);
    if (leftoverN) parts.push(`${formatQty(leftoverN, unit)} reutilizable`);
    onDone(parts.join(" · "));
  };

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
        <PackageX className="mx-auto mb-3 size-8 text-slate-400" aria-hidden />
        <p className="font-medium text-slate-800">Este proyecto no tiene material asignado</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          {big
            ? "Solo se puede registrar material que esté comprado o asignado a este proyecto. Pedilo y un usuario Administrativo lo asigna, lo compra o lo transfiere."
            : "Registrá una compra o asigná material del stock desde la pestaña Materiales. Solo se puede consumir lo que el proyecto tiene asignado."}
        </p>
        {big && onRequestMaterial && (
          <Button size="xl" className="mt-4 w-full" onClick={onRequestMaterial}>
            Solicitar material
          </Button>
        )}
      </div>
    );
  }

  const labelCls = cn("mb-2 block font-medium text-slate-800", big ? "text-base" : "text-sm");
  const field = cn(big && "h-12 text-base");

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className={labelCls}>¿Qué material?</legend>
        <div className="grid gap-2" role="radiogroup" aria-label="Material">
          {groups.map((g) => (
            <button
              key={g.materialId}
              type="button"
              role="radio"
              aria-checked={materialId === g.materialId}
              onClick={() => {
                setMaterialId(g.materialId);
                setLotId("");
                setError("");
              }}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md border px-4 text-left",
                big ? "min-h-14 py-3 text-base" : "min-h-11 py-2 text-sm",
                materialId === g.materialId ? "border-blue-600 bg-blue-50 font-medium text-blue-900 ring-1 ring-blue-600" : "border-slate-300 bg-white",
              )}
            >
              <span>{g.name}</span>
              <span className="shrink-0 text-sm text-slate-600 tabular">Asignado a este proyecto: {formatQty(g.quantity, g.unit)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {group && (
        <>
          {group.lots.length > 1 && (
            <fieldset>
              <legend className={labelCls}>¿De cuál?</legend>
              <div className="grid gap-2">
                <button
                  type="button"
                  aria-pressed={lotId === ""}
                  onClick={() => setLotId("")}
                  className={cn("rounded-md border px-4 py-2 text-left text-sm", lotId === "" ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-300")}
                >
                  Automático (primero lo comprado, al final los sobrantes)
                </button>
                {group.lots.map((l) => (
                  <button
                    key={l.lot.id}
                    type="button"
                    aria-pressed={lotId === l.lot.id}
                    onClick={() => setLotId(l.lot.id)}
                    className={cn("rounded-md border px-4 py-2 text-left text-sm", lotId === l.lot.id ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-300")}
                  >
                    <span className="font-medium">{formatQty(l.quantity, unit)}</span>{" "}
                    {l.lot.kind === "leftover" ? `· sobrante${formatDims(l.lot.dims) ? ` (${formatDims(l.lot.dims)})` : ""}` : l.lot.originProjectId === project.id ? "· comprado para este proyecto" : "· del stock"}
                    {l.lot.originProjectName && l.lot.kind === "leftover" ? ` · de ${l.lot.originProjectName}` : ""}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <QuantityInput id="u-used" label="Cantidad usada" value={used} onChange={setUsed} unit={unit} step={big ? 1 : 0.5} />

          <div className="space-y-3">
            <YesNo label="¿Hubo desperdicio? (no se puede reutilizar)" value={hasWaste} onChange={setHasWaste} big={big} />
            {hasWaste && <QuantityInput id="u-waste" label="Cantidad desperdiciada" value={waste} onChange={setWaste} unit={unit} step={0.1} />}
          </div>

          <div className="space-y-3">
            <YesNo label="¿Quedó material reutilizable? (conserva su valor)" value={hasLeftover} onChange={setHasLeftover} big={big} />
            {hasLeftover && (
              <>
                <QuantityInput id="u-left" label="Cantidad reutilizable" value={leftover} onChange={setLeftover} unit={unit} step={0.1} />
                <LeftoverDimsFields unit={unit} value={dims} onChange={setDims} big={big} idPrefix="u-dim" />
                <div>
                  <label htmlFor="u-loc" className="mb-1 block text-sm font-medium text-slate-700">
                    Ubicación del sobrante <span className="font-normal text-slate-500">(opcional)</span>
                  </label>
                  <Input id="u-loc" value={location} onChange={(e) => setLocation(e.target.value)} className={field} />
                </div>
              </>
            )}
          </div>

          {project.items.length > 0 && (
            <div>
              <label htmlFor="u-item" className="mb-1 block text-sm font-medium text-slate-700">
                ¿Para qué producto? <span className="font-normal text-slate-500">(opcional)</span>
              </label>
              <Select id="u-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className={field}>
                <option value="">General del proyecto</option>
                {project.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {!big && (
            <div>
              <label htmlFor="u-date" className="mb-1 block text-sm font-medium text-slate-700">
                Fecha
              </label>
              <Input id="u-date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}

          {over && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              Superás lo asignado a este proyecto: tiene {formatQty(available, unit)} de {group.name}
              {big ? ". Pedí más material." : "."}
            </p>
          )}

          {!big && usedN + wasteN > 0 && (
            <div className="rounded-md bg-slate-50 p-3 text-sm">
              Se imputa al proyecto: <strong className="tabular">{formatCurrency((usedN + wasteN) * unitCost)}</strong>
              <span className="text-slate-500"> (consumo + desperdicio, al costo del lote)</span>
              {leftoverN > 0 && (
                <div className="text-slate-500">
                  Sobrante que conserva valor: <span className="tabular">{formatCurrency(leftoverN * unitCost)}</span> (no es costo)
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <Button size={big ? "xl" : "default"} className="w-full" onClick={submit} disabled={over}>
            Guardar
          </Button>
        </>
      )}
    </div>
  );
}
