import type { Project, WorkAssignment, Operator } from "@/types";
import { exceeds, type Threshold } from "./plant";
export interface HoursReview {
  key: string; operatorId: string; worker: string; date: string;
  reason: "distribution" | "missing" | "excess";
  assignments: WorkAssignment[];
  entries: Project["actualEntries"];
  message: string;
}
/** One review per person/day. Today's missing work is not overdue. No monetary data. */
export function dailyHoursReviews(projects: Project[], assignments: WorkAssignment[], operators: Operator[], today: string, threshold: Threshold): HoursReview[] {
  const result: HoursReview[] = [];
  const groups = new Map<string, WorkAssignment[]>();
  for (const a of assignments) {
    if (a.date > today || !projects.some((p) => p.id === a.projectId && !p.isClosed)) continue;
    const key = `${a.operatorId}|${a.date}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  for (const [group, rows] of groups) {
    rows.sort((a,b) => a.id.localeCompare(b.id));
    const { operatorId, date } = rows[0];
    const entries = projects.flatMap((p) => p.actualEntries).filter((e) => e.type === "labor" && e.operatorId === operatorId && e.date === date).sort((a,b) => a.id.localeCompare(b.id));
    const logged = (a: WorkAssignment) => entries.filter((e) => e.assignmentId === a.id).reduce((s,e) => s+(e.labor?.hours ?? 0),0);
    const total = entries.reduce((s,e) => s+(e.labor?.hours ?? 0),0);
    const planned = rows.reduce((s,a) => s+a.plannedHours,0);
    const missing = rows.some((a) => logged(a) < a.plannedHours - .01);
    const concentrated = new Set(rows.map((a) => a.projectId)).size > 1 && new Set(entries.map((e) => e.projectId)).size === 1 && total >= planned && rows.some((a) => logged(a) === 0);
    const reason = concentrated ? "distribution" : exceeds(planned,total,threshold) ? "excess" : date < today && missing ? "missing" : null;
    if (!reason) continue;
    const worker = operators.find((o) => o.id === operatorId)?.name ?? "Operario";
    const detail = rows.map((a) => `${projects.find((p) => p.id === a.projectId)?.code ?? a.projectId}: ${a.plannedHours} h previstas, ${logged(a)} h cargadas`).join("; ");
    const fingerprint = JSON.stringify([rows.map((a) => [a.id,a.plannedHours,a.projectId]),entries.map((e) => [e.id,e.assignmentId,e.labor?.hours])]);
    result.push({ key: `${group}|${fingerprint}`, operatorId, worker, date, reason, assignments: rows, entries,
      message: `Revisar horas de ${worker}. ${detail}. ${concentrated ? "Posible imputación incorrecta." : reason === "missing" ? "Quedan horas por revisar." : "Se superó lo previsto."}` });
  }
  return result;
}
