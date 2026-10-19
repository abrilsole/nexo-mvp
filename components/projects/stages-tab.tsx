"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useState } from "react";
import { TriangleAlert, NotebookPen } from "lucide-react";
import type { Project, StageKey } from "@/types";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/constants";
import { formatDate, todayISO } from "@/lib/formatting";
import { useIdentity } from "@/store/selectors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { AttachButton, AttachmentList } from "@/components/shared/attachments";

const STAGES: StageKey[] = ["purchasing", "production", "installation"];

/** Notas e incidencias por etapa, en orden cronológico. */
export function StagesTab({ project }: { project: Project }) {
  const addStageLog = useConfirmedAction("addStageLog");
  const { isManager, actor } = useIdentity();
  const reached = STAGES.filter((s) => STATUS_ORDER.indexOf(s) <= STATUS_ORDER.indexOf(project.status));
  const [stage, setStage] = useState<StageKey>(reached[reached.length - 1] ?? "purchasing");
  const [kind, setKind] = useState<"note" | "incident">("note");
  const [text, setText] = useState("");
  const [responsible, setResponsible] = useState("");
  const [itemId, setItemId] = useState("");
  const [error, setError] = useState("");
  const canWrite = !project.isClosed && reached.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await addStageLog(project.id, {
      stage,
      date: todayISO(),
      kind,
      text,
      ...(responsible.trim() ? { responsible: responsible.trim() } : { responsible: actor }),
      ...(itemId ? { itemId } : {}),
    });
    if (!r.ok) return setError(r.error);
    setText(""); setResponsible(""); setError("");
  };

  return (
    <div className="space-y-6">
      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>Agregar nota o incidencia</CardTitle>
            <CardDescription>Dejá constancia de lo que pasó en cada etapa. Queda ordenado por fecha.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
              <Field label="Etapa" htmlFor="sl-stage">
                <Select id="sl-stage" value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
                  {reached.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </Select>
              </Field>
              <Field label="Tipo" htmlFor="sl-kind">
                <Select id="sl-kind" value={kind} onChange={(e) => setKind(e.target.value as "note" | "incident")}>
                  <option value="note">Nota</option>
                  <option value="incident">Incidencia</option>
                </Select>
              </Field>
              <Field label="Qué pasó" htmlFor="sl-text" className="md:col-span-2">
                <Textarea id="sl-text" value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <Field label="Responsable (opcional)" htmlFor="sl-resp">
                <Input id="sl-resp" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder={actor} />
              </Field>
              <Field label="Producto (opcional)" htmlFor="sl-item">
                <Select id="sl-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">General del proyecto</option>
                  {project.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </Select>
              </Field>
              {error && <p role="alert" className="text-sm text-red-600 md:col-span-2">{error}</p>}
              <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                <Button type="submit">Guardar</Button>
                <AttachButton projectId={project.id} stage={stage} label="Adjuntar foto o documento a la etapa" />
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {STAGES.map((s) => {
        const logs = project.stageLogs.filter((l) => l.stage === s).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
        const files = project.attachments.filter((a) => a.stage === s && !a.itemId);
        const isReached = reached.includes(s);
        return (
          <Card key={s}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {STATUS_LABELS[s]}
                {project.status === s && <Badge tone="blue">Etapa actual</Badge>}
                {!isReached && <Badge tone="gray">Todavía no llegó</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {logs.length === 0 ? (
                <p className="text-sm text-slate-500">{isReached ? "Sin notas ni incidencias." : "—"}</p>
              ) : (
                <ol className="space-y-3">
                  {logs.map((l) => {
                    const item = project.items.find((i) => i.id === l.itemId);
                    return (
                      <li key={l.id} className="flex gap-3 text-sm">
                        {l.kind === "incident" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Incidencia" /> : <NotebookPen className="mt-0.5 size-4 shrink-0 text-slate-400" aria-label="Nota" />}
                        <div className="min-w-0">
                          <p className="text-slate-800">{l.text}</p>
                          <p className="text-xs text-slate-500">
                            {formatDate(l.date)} · {l.responsible ?? l.createdBy}{item ? ` · ${item.name}` : ""}{l.kind === "incident" ? " · Incidencia" : ""}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              {files.length > 0 && <AttachmentList attachments={files} projectId={project.id} canRemove={isManager && !project.isClosed} />}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
