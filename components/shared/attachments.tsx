"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useRef, useState } from "react";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import type { Attachment, StageKey } from "@/types";
import { attachmentUrl, uploadAttachment } from "@/lib/attachments";
import { formatDate } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { Button } from "@/components/ui/button";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function AttachmentList({ attachments, projectId, canRemove }: { attachments: Attachment[]; projectId: string; canRemove?: boolean }) {
  const removeAttachment = useConfirmedAction("removeAttachment");
  const [error, setError] = useState("");
  const open = async (a: Attachment) => {
    const url = await attachmentUrl(a.storagePath);
    if (!url) return setError("No se pudo abrir el archivo.");
    window.open(url, "_blank", "noopener,noreferrer");
  };
  if (attachments.length === 0) return <p className="text-sm text-slate-500">Sin archivos adjuntos.</p>;
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
            <FileText className="size-4 shrink-0 text-slate-400" aria-hidden />
            <button type="button" onClick={() => open(a)} className="min-w-0 flex-1 break-words text-left font-medium text-blue-700 hover:underline">
              {a.name}
            </button>
            <span className="hidden text-xs text-slate-500 sm:inline">{kb(a.size)} · {a.uploadedBy} · {formatDate(a.uploadedAt)}</span>
            {canRemove && (
              <Button size="icon" variant="ghost" aria-label={`Quitar ${a.name}`} onClick={async () => await removeAttachment(projectId, a.id)}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Botón para adjuntar fotos/documentos al proyecto, a un producto o a una etapa. */
export function AttachButton({
  projectId,
  itemId,
  stage,
  label = "Adjuntar archivo",
  capture,
}: {
  projectId: string;
  itemId?: string;
  stage?: StageKey;
  label?: string;
  capture?: boolean;
}) {
  const orgId = useAppStore((s) => s.organizationId);
  const addAttachment = useConfirmedAction("addAttachment");
  const { actor } = useIdentity();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const f of Array.from(files)) {
        const att = await uploadAttachment(f, { organizationId: orgId, projectId, itemId, stage, uploadedBy: actor });
        const r = await addAttachment(projectId, att);
        if (!r.ok) throw new Error(r.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo adjuntar.");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div>
      <input ref={ref} type="file" multiple className="sr-only" id={`att-${projectId}-${itemId ?? stage ?? "g"}`} aria-label={label} accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf" {...(capture ? { capture: "environment" } : {})} onChange={(e) => onFiles(e.target.files)} />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
        <Paperclip /> {busy ? "Subiendo…" : label}
      </Button>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
