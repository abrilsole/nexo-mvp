"use client";
import { useState } from "react";
import { useAppStore } from "@/store/use-app-store";
import { dailyHoursReviews, type HoursReview } from "@/lib/hours-review";
import { thresholdOf } from "@/lib/plant";
import { todayISO } from "@/lib/formatting";
import { createClient } from "@/lib/supabase/client";
import { createId } from "@/lib/activity";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export function HoursReviews() {
  const projects = useAppStore(s => s.projects);
  const assignments = useAppStore(s => s.assignments);
  const operators = useAppStore(s => s.operators);
  const settings = useAppStore(s => s.settings);
  const reviewed = useAppStore(s => s.reviewedHoursKeys);
  const rows = dailyHoursReviews(projects, assignments, operators, todayISO(), thresholdOf(settings));
  return <section className="space-y-3" aria-label="Revisión de horas por jornada">
    <h2 className="font-semibold">Revisión de horas por jornada</h2>
    {!rows.length && <p className="text-sm text-slate-500">No hay jornadas pendientes de revisión.</p>}
    {rows.map(row => <Review key={row.key} row={row} reviewed={reviewed.includes(row.key)} />)}
  </section>;
}
function Review({ row, reviewed }: { row: HoursReview; reviewed: boolean }) {
  const [open,setOpen] = useState(false);
  const [entryId,setEntryId] = useState(row.entries[0]?.id ?? "");
  const [hours,setHours] = useState<Record<string,string>>({});
  const [reason,setReason] = useState("");
  const [error,setError] = useState("");
  const [requestId] = useState(() => createId("hc"));
  const busy = useAppStore(s=>s.syncStatus === "saving");
  const projects = useAppStore(s=>s.projects);
  const entry = row.entries.find(e => e.id === entryId);
  const run = async (correct: boolean) => {
    setError("");
    const result = await useAppStore.getState().confirmOperation(async () => {
      const db = createClient();
      const response = correct && entry ? await db.rpc("planta_correct_hours", { p: {
        id: requestId, entry_id: entry.id, expected_hours: entry.labor?.hours, expected_assignment_id: entry.assignmentId,
        reason, allocations: row.assignments.map(a => ({ assignment_id:a.id, hours:Number((hours[a.id] ?? "0").replace(",",".")) })).filter(a => a.hours !== 0),
      } }) : await db.rpc("planta_confirm_hours", { p_key: row.key });
      if (response.error) throw new Error(response.error.message);
      return { ok:true as const, value:undefined };
    });
    if (!result.ok) setError(result.error); else setOpen(false);
  };
  return <div className="rounded-lg border p-4 space-y-3">
    <p className="text-sm">{row.date} · {row.message}</p>
    {reviewed ? <p className="text-sm text-emerald-700">Revisada: se confirmó la carga. Se volverá a revisar si cambian los datos.</p> : <div className="flex gap-2">
      <Button disabled={busy} variant="outline" onClick={()=>void run(false)}>Confirmar que está bien</Button>
      {row.entries.length > 0 && <Button disabled={busy} onClick={()=>setOpen(!open)}>Redistribuir horas</Button>}
    </div>}
    {open && <div className="space-y-3">
      <label className="block text-sm">Registro a corregir
        <Select value={entryId} onChange={e=>setEntryId(e.target.value)}>{row.entries.map(e=><option key={e.id} value={e.id}>{projects.find(p=>p.id===e.projectId)?.code} · {e.labor?.hours} h</option>)}</Select>
      </label>
      <p className="text-xs text-slate-600">Repartí las {entry?.labor?.hours} h del registro. El total debe mantenerse. Los demás registros no cambian.</p>
      {row.assignments.map(a=><label key={a.id} className="block text-sm">{projects.find(p=>p.id===a.projectId)?.code} · {a.rubro}
        <Input inputMode="decimal" value={hours[a.id] ?? ""} onChange={e=>setHours({...hours,[a.id]:e.target.value})} placeholder="0" />
      </label>)}
      <label className="block text-sm">Motivo<Input value={reason} onChange={e=>setReason(e.target.value)} /></label>
      <Button disabled={busy} onClick={()=>void run(true)}>Guardar corrección</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
