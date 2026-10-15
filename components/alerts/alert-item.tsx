"use client";
import Link from "next/link";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import type { Alert } from "@/types";
import { formatSignedCurrency } from "@/lib/formatting";
import { AlertLevelBadge } from "@/components/shared/badges";
import { MarginShift } from "@/components/shared/margin-shift";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/use-app-store";
import { cn } from "@/lib/utils";

/** `readOnly`: sin "Marcar resuelta" ni link al proyecto (Jefe de planta: no ve la pantalla del proyecto con importes). */
export function AlertItem({
  alert,
  resolved = false,
  showProject = true,
  compact = false,
  readOnly = false,
}: {
  alert: Alert;
  resolved?: boolean;
  showProject?: boolean;
  compact?: boolean;
  readOnly?: boolean;
}) {
  const resolveAlert = useAppStore((s) => s.resolveAlert);
  const reopenAlert = useAppStore((s) => s.reopenAlert);
  const border = alert.level === "critical" ? "border-l-red-500" : alert.level === "warning" ? "border-l-amber-500" : "border-l-blue-400";
  return (
    <div className={cn("rounded-lg border border-l-4 border-slate-200 bg-white p-4", border, resolved && "opacity-60")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <AlertLevelBadge level={alert.level} />
            {showProject && (
              <span className="text-sm font-medium text-slate-900">
                {alert.projectName} <span className="font-normal text-slate-500">· {alert.projectCode}</span>
              </span>
            )}
          </div>
          <p className="font-medium text-slate-900">{alert.title}</p>
          <p className="text-sm text-slate-600">{alert.message}</p>
          {alert.records && alert.records.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer text-blue-700 hover:underline">De dónde sale ({alert.records.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {alert.records.map((r) => (
                  <li key={r} className="break-words">{r}</li>
                ))}
              </ul>
            </details>
          )}
          {!compact && alert.impactAmount !== undefined && alert.impactAmount > 0 && (
            <p className="text-sm text-slate-600">
              Impacto: <strong className="tabular text-red-700">{formatSignedCurrency(alert.impactAmount)}</strong>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-3 md:items-end">
          {!compact && alert.expectedMargin !== undefined && alert.projectedMargin !== undefined && (
            <MarginShift from={alert.expectedMargin} to={alert.projectedMargin} />
          )}
          {!readOnly && (
          <div className="flex gap-2">
            {resolved ? (
              <Button variant="ghost" size="sm" onClick={() => reopenAlert(alert.resolutionKey)}>
                <RotateCcw /> Reabrir
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => resolveAlert(alert.resolutionKey)}>
                <Check /> Marcar resuelta
              </Button>
            )}
            {showProject && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/projects/${alert.projectId}`}>
                  Ver proyecto <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
