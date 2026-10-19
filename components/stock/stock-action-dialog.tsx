"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo, useState } from "react";
import type { Project } from "@/types";
import { parseDims, dimFieldsForUnit, type DimsDraft } from "@/lib/material-kinds";
import { parseDecimal } from "@/lib/schemas";
import { formatQty } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { LeftoverDimsFields } from "./leftover-dims-fields";

export type StockAction = "assign" | "release" | "transfer" | "leftover" | "supplier";

export interface StockTarget {
  materialId: string;
  materialName: string;
  unit: string;
  /** Máximo que se puede mover (lo libre en depósito o lo asignado al proyecto). */
  max: number;
  /** Proyecto de origen (release / transfer / leftover / supplier). */
  fromProjectId?: string;
  /** Proyecto de destino ya decidido (asignar desde la pestaña del proyecto). */
  toProjectId?: string;
  /** Lote puntual (un sobrante concreto). */
  lotId?: string;
  lotLabel?: string;
}

const COPY: Record<StockAction, { title: string; verb: string; help: string }> = {
  assign: {
    title: "Asignar a un proyecto",
    verb: "Asignar",
    help: "Reserva el material del stock para ese proyecto. Todavía no es costo: lo será cuando se consuma.",
  },
  release: {
    title: "Devolver al stock",
    verb: "Devolver al stock",
    help: "El material vuelve al stock libre con su costo original. No es costo del proyecto.",
  },
  transfer: {
    title: "Transferir a otro proyecto",
    verb: "Transferir",
    help: "Pasa el material a otro proyecto con su costo original. Queda registrado de dónde vino.",
  },
  leftover: {
    title: "Marcar como sobrante reutilizable",
    verb: "Marcar sobrante",
    help: "Conserva su valor y queda disponible para otros proyectos. No es desperdicio ni costo.",
  },
  supplier: {
    title: "Devolver al proveedor",
    verb: "Devolver al proveedor",
    help: "El material sale del stock y no es costo del proyecto.",
  },
};

const receivers = (projects: Project[], excludeId?: string) =>
  projects.filter((p) => !p.isClosed && p.status !== "quotation" && p.id !== excludeId);

export function StockActionDialog({
  action,
  target,
  open,
  onOpenChange,
}: {
  action: StockAction;
  target: StockTarget;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const projects = useAppStore((s) => s.projects);
  const assignStock = useConfirmedAction("assignStock");
  const releaseStock = useConfirmedAction("releaseStock");
  const transferStock = useConfirmedAction("transferStock");
  const markLeftover = useConfirmedAction("markLeftover");
  const returnToSupplier = useAppStore((s) => s.returnStockToSupplier);

  const [qty, setQty] = useState("");
  const [toProject, setToProject] = useState(target.toProjectId ?? "");
  const [dest, setDest] = useState<"warehouse" | "project">("warehouse");
  const [location, setLocation] = useState("");
  const [dims, setDims] = useState<DimsDraft>({});
  const [error, setError] = useState("");

  const candidates = useMemo(() => receivers(projects, target.fromProjectId), [projects, target.fromProjectId]);
  const copy = COPY[action];
  const needsProject = action === "assign" || action === "transfer" || (action === "leftover" && dest === "project");

  const submit = async () => {
    const quantity = parseDecimal(qty || "0");
    if (!Number.isFinite(quantity) || quantity <= 0) return setError("Indicá cuánto material.");
    if (quantity - target.max > 1e-6) return setError(`Como máximo podés mover ${formatQty(target.max, target.unit)}.`);
    if (needsProject && !toProject) return setError("Elegí el proyecto de destino.");
    const base = {
      materialId: target.materialId,
      materialName: target.materialName,
      unit: target.unit,
      quantity,
      lotId: target.lotId,
    };
    let res;
    if (action === "assign") res = await assignStock({ ...base, projectId: toProject });
    else if (action === "release") res = await releaseStock({ ...base, projectId: target.fromProjectId ?? "" });
    else if (action === "transfer") res = await transferStock({ ...base, fromProjectId: target.fromProjectId ?? "", toProjectId: toProject });
    else if (action === "supplier") res = returnToSupplier({ ...base, projectId: target.fromProjectId ?? "" });
    else {
      const parsed = parseDims(dimFieldsForUnit(target.unit), dims);
      if (parsed.error) return setError(parsed.error);
      res = await markLeftover({
        ...base,
        projectId: target.fromProjectId ?? "",
        dims: parsed.dims,
        location: location.trim() || undefined,
        destination: dest === "project" ? { projectId: toProject } : "warehouse",
      });
    }
    if (!res.ok) return setError(res.error);
    setQty("");
    setError("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setError(""); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {target.materialName}
            {target.lotLabel ? ` · ${target.lotLabel}` : ""} · podés mover hasta {formatQty(target.max, target.unit)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">{copy.help}</p>
          <Field label={`Cantidad (${target.unit})`} htmlFor="sa-qty">
            <div className="flex gap-2">
              <Input id="sa-qty" inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => setQty(String(target.max).replace(".", ","))}>
                Todo
              </Button>
            </div>
          </Field>
          {action === "leftover" && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-700">¿Adónde va el sobrante?</legend>
              <Choice<"warehouse" | "project">
                name="Destino del sobrante"
                value={dest}
                onChange={setDest}
                options={[
                  { value: "warehouse", label: "Al stock (libre)" },
                  { value: "project", label: "A otro proyecto" },
                ]}
              />
            </fieldset>
          )}
          {needsProject && !target.toProjectId && (
            <Field label="Proyecto de destino" htmlFor="sa-project">
              <Select id="sa-project" value={toProject} onChange={(e) => setToProject(e.target.value)}>
                <option value="">Elegí un proyecto…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {action === "leftover" && (
            <>
              <LeftoverDimsFields unit={target.unit} value={dims} onChange={setDims} idPrefix="sa-dim" />
              {dest === "warehouse" && (
                <Field label="Ubicación (opcional)" htmlFor="sa-loc" hint="Ej.: Estante 3, rack de placas.">
                  <Input id="sa-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
                </Field>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>{copy.verb}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
