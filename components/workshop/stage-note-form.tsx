"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useState } from "react";
import type { Project, StageKey } from "@/types";
import { STATUS_LABELS } from "@/lib/constants";
import { todayISO } from "@/lib/formatting";
import { useIdentity } from "@/store/selectors";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Textarea } from "@/components/ui/input";
import { AttachButton } from "@/components/shared/attachments";

const isStage = (s: string): s is StageKey => s === "purchasing" || s === "production" || s === "installation";

/** Nota o incidencia de la etapa actual, con foto opcional. */
export function StageNoteForm({ project, onDone }: { project: Project; onDone: (s: string) => void }) {
  const addStageLog = useConfirmedAction("addStageLog");
  const { actor } = useIdentity();
  const [kind, setKind] = useState<"note" | "incident">("incident");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const stage: StageKey = isStage(project.status) ? project.status : "production";

  const submit = async () => {
    const r = await addStageLog(project.id, { stage, date: todayISO(), kind, text, responsible: actor });
    if (!r.ok) return setError(r.error);
    onDone(kind === "incident" ? "Incidencia registrada." : "Nota registrada.");
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nota o incidencia</h1>
      <p className="text-sm text-slate-600">Etapa: {STATUS_LABELS[stage]}</p>
      <Choice<"note" | "incident"> name="Tipo" size="lg" value={kind} onChange={setKind} options={[{ value: "incident", label: "Incidencia" }, { value: "note", label: "Nota" }]} />
      <div>
        <label htmlFor="sn-text" className="mb-1.5 block text-base font-medium">¿Qué pasó?</label>
        <Textarea id="sn-text" className="min-h-28 text-base" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <AttachButton projectId={project.id} stage={stage} label="Sacar o adjuntar foto" capture />
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Button size="xl" className="w-full" onClick={submit}>Guardar</Button>
    </div>
  );
}
