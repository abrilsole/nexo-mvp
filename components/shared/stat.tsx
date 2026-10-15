import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HelpTip } from "@/components/ui/help-tip";

export function Stat({
  label,
  value,
  hint,
  tooltip,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tooltip?: string;
  tone?: "default" | "red" | "yellow" | "green";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-4 shadow-sm", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {label}
        {tooltip && <HelpTip label={label}>{tooltip}</HelpTip>}
      </div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular tracking-tight",
          tone === "red" ? "text-red-700" : tone === "yellow" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-slate-900",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/** Número con ícono que lleva a su pantalla (resúmenes de Jefe de planta y Compras). */
export function StatLink({ icon: Icon, label, value, href, tone }: { icon: LucideIcon; label: string; value: string; href: string; tone?: "warn" }) {
  return (
    <Link href={href} className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-blue-600">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Icon className="size-4" aria-hidden /> {label}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular", tone === "warn" ? "text-amber-700" : "text-slate-900")}>{value}</div>
    </Link>
  );
}
