"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ProductRubro, Project, ProjectItem, RubroId } from "@/types";
import { formatCurrency, formatNumber } from "@/lib/formatting";
import { itemHours, productStatus, type ProductInput } from "@/lib/production";
import { RUBROS, rubroLabel } from "@/lib/rubros";
import { parseDecimal } from "@/lib/schemas";
import { ProductionBadge } from "@/components/shared/badges";
import { useIdentity } from "@/store/selectors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { AttachButton, AttachmentList } from "@/components/shared/attachments";

/**
 * Productos del proyecto (ej. "Mesa × 10"): el Administrativo define, para cada uno, los rubros que necesita con sus
 * horas estimadas y cuántos operarios pide cada rubro. Las unidades terminadas las carga el Jefe de planta.
 * Los materiales, horas, archivos y costos se pueden asociar a cada producto.
 */
export function ItemsTab({ project }: { project: Project }) {
  const removeItem = useConfirmedAction("removeItem");
  const { isManager } = useIdentity();
  const [editing, setEditing] = useState<string | null>(null);
  const editable = isManager && !project.isClosed;

  const costOf = (itemId: string | undefined) => {
    const mats = project.materialUsages.filter((u) => u.itemId === itemId).reduce((s, u) => s + (u.quantityConsumed + u.wasteQuantity) * u.unitCost, 0);
    const other = project.actualEntries.filter((a) => a.itemId === itemId).reduce((s, a) => s + a.amount, 0);
    return { mats, other, total: mats + other };
  };
  const general = project.attachments.filter((a) => !a.itemId && !a.stage);
  const generalCost = costOf(undefined);

  return (
    <div className="space-y-6">
      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Agregar producto</CardTitle>
            <CardDescription>
              Nombre y cantidad (ej. “Silla × 100”) y, por cada rubro que necesita, las horas estimadas para toda la cantidad y cuántos operarios pide.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProductForm project={project} onDone={() => undefined} />
          </CardContent>
        </Card>
      )}

      {project.items.map((it) => {
        const c = costOf(it.id);
        const files = project.attachments.filter((a) => a.itemId === it.id);
        const hours = itemHours(project, it.id);
        return (
          <Card key={it.id}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {it.name} <span className="text-sm font-normal text-slate-500">× {it.quantity}</span>
                  <ProductionBadge status={productStatus(it, hours)} />
                </CardTitle>
                <CardDescription>
                  {it.completedUnits} de {it.quantity} terminadas (las carga el Jefe de planta) · {formatNumber(hours)} h cargadas
                  {it.description ? ` · ${it.description}` : ""}
                </CardDescription>
              </div>
              {editable && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label={`Editar ${it.name}`} onClick={() => setEditing(editing === it.id ? null : it.id)}><Pencil /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Quitar ${it.name}`} onClick={async () => await removeItem(project.id, it.id)}><Trash2 /></Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {editing === it.id ? (
                <ProductForm project={project} item={it} onDone={() => setEditing(null)} />
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {it.rubros.map((r) => (
                    <li key={r.rubro} className="flex flex-wrap justify-between gap-2 py-1">
                      <span>{rubroLabel(r.rubro)}</span>
                      <span className="tabular text-slate-600">
                        {formatNumber(r.hours)} h estimadas · {r.workers} {r.workers === 1 ? "operario" : "operarios"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {isManager && (
                <p className="text-sm text-slate-600">
                  Costo real asociado: <strong className="tabular">{formatCurrency(c.total)}</strong>
                  <span className="text-slate-400"> · materiales {formatCurrency(c.mats)} · otros {formatCurrency(c.other)}</span>
                </p>
              )}
              <AttachmentList attachments={files} projectId={project.id} canRemove={editable} />
              {!project.isClosed && <AttachButton projectId={project.id} itemId={it.id} />}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>General del proyecto</CardTitle>
          <CardDescription>Planos, fotos y documentos que no son de un producto en particular.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isManager && project.items.length > 0 && (
            <p className="text-sm text-slate-600">Costo real sin producto asignado: <strong className="tabular">{formatCurrency(generalCost.total)}</strong></p>
          )}
          <AttachmentList attachments={general} projectId={project.id} canRemove={editable} />
          {!project.isClosed && <AttachButton projectId={project.id} />}
        </CardContent>
      </Card>
    </div>
  );
}

const FULL_RUBROS = RUBROS.filter((r) => r.kind === "full");

interface RubroDraft {
  rubro: RubroId;
  hours: string;
  workers: string;
}

const draftOf = (r: ProductRubro): RubroDraft => ({ rubro: r.rubro, hours: String(r.hours).replace(".", ","), workers: String(r.workers) });

/** Alta o edición de un producto con sus rubros (horas estimadas y operarios pedidos). */
function ProductForm({ project, item, onDone }: { project: Project; item?: ProjectItem; onDone: () => void }) {
  const addItem = useConfirmedAction("addItem");
  const updateItem = useConfirmedAction("updateItem");
  const [name, setName] = useState(item?.name ?? "");
  const [qty, setQty] = useState(String(item?.quantity ?? 1));
  const [description, setDescription] = useState(item?.description ?? "");
  const [rubros, setRubros] = useState<RubroDraft[]>(item ? item.rubros.map(draftOf) : [{ rubro: "carpinteria_madera", hours: "", workers: "1" }]);
  const [error, setError] = useState("");
  const key = item?.id ?? "new";
  const setRow = (i: number, patch: Partial<RubroDraft>) => setRubros(rubros.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input: ProductInput = {
      name,
      quantity: Number(qty),
      description: description.trim() || undefined,
      rubros: rubros.map((r) => ({ rubro: r.rubro, hours: parseDecimal(r.hours), workers: Number(r.workers) })),
    };
    const r = item ? await updateItem(project.id, item.id, input) : await addItem(project.id, input);
    if (!r.ok) return setError(r.error);
    setError("");
    if (!item) {
      setName("");
      setQty("1");
      setDescription("");
      setRubros([{ rubro: "carpinteria_madera", hours: "", workers: "1" }]);
    }
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_3fr]">
        <Field label="Nombre" htmlFor={`it-name-${key}`}><Input id={`it-name-${key}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Silla apilable" /></Field>
        <Field label="Cantidad" htmlFor={`it-qty-${key}`}><Input id={`it-qty-${key}`} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Descripción (opcional)" htmlFor={`it-desc-${key}`}><Input id={`it-desc-${key}`} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Rubros que necesita</legend>
        {rubros.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2">
            <Field label="Rubro" htmlFor={`it-r-${key}-${i}`}>
              <Select id={`it-r-${key}-${i}`} value={r.rubro} onChange={(e) => setRow(i, { rubro: e.target.value as RubroId })}>
                {FULL_RUBROS.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Horas" htmlFor={`it-h-${key}-${i}`}><Input id={`it-h-${key}-${i}`} inputMode="decimal" value={r.hours} onChange={(e) => setRow(i, { hours: e.target.value })} /></Field>
            <Field label="Operarios" htmlFor={`it-w-${key}-${i}`}><Input id={`it-w-${key}-${i}`} type="number" min={1} value={r.workers} onChange={(e) => setRow(i, { workers: e.target.value })} /></Field>
            <Button type="button" size="icon" variant="ghost" aria-label={`Quitar rubro ${i + 1}`} disabled={rubros.length === 1} onClick={() => setRubros(rubros.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setRubros([...rubros, { rubro: FULL_RUBROS.find((x) => !rubros.some((y) => y.rubro === x.id))?.id ?? "embalaje", hours: "", workers: "1" }])}>
          <Plus /> Rubro
        </Button>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit">{item ? "Guardar cambios" : "Agregar producto"}</Button>
        {item && <Button type="button" variant="outline" onClick={onDone}>Cancelar</Button>}
      </div>
    </form>
  );
}
