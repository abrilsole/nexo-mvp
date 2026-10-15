"use client";
// Historial de un valor con vigencia (tarifa, multiplicador, costo por hora, precio de material).
import type { PriceKind } from "@/types";
import { formatDate, formatNumber, todayISO } from "@/lib/formatting";
import { BEFORE_HISTORY, historyFor, priceTimeline } from "@/lib/price-history";
import { useAppStore } from "@/store/use-app-store";

const STATUS_TEXT = { current: "vigente", scheduled: "programado", previous: "anterior" } as const;

export function PriceHistoryList({ kind, subjectId, label, format = (v) => `$ ${formatNumber(v, 2)}` }: { kind: PriceKind; subjectId: string; label: string; format?: (v: number) => string }) {
  const all = useAppStore((s) => s.priceHistory);
  const history = historyFor(all, kind, subjectId);
  if (history.length === 0) return <p className="text-xs text-slate-500">Sin cambios registrados todavía.</p>;
  const rows = priceTimeline(history, todayISO());
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-blue-700 hover:underline">Ver historial ({rows.length})</summary>
      <ul aria-label={`Historial de ${label}`} className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-slate-600">
            <span className="tabular font-medium text-slate-900">{format(r.value)}</span>
            <span>{r.validFrom === BEFORE_HISTORY ? "valor anterior al primer cambio" : `desde ${formatDate(r.validFrom)}`}</span>
            <span className={r.status === "current" ? "font-semibold text-emerald-700" : r.status === "scheduled" ? "font-semibold text-blue-700" : "text-slate-400"}>
              · {STATUS_TEXT[r.status]}
            </span>
            {r.validFrom !== BEFORE_HISTORY && <span className="text-slate-400">· cargado por {r.createdBy || "—"}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
