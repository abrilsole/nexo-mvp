"use client";
import { cn } from "@/lib/utils";

/** Selector segmentado accesible (radiogroup). Usado para No/Sí y orígenes. */
export function Choice<T extends string>({
  value,
  onChange,
  options,
  name,
  size = "default",
  columns,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  name: string;
  /** sm: texto chico que puede pasar a dos líneas (lugares angostos como la barra lateral). */
  size?: "default" | "sm" | "lg";
  columns?: number;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={cn("grid gap-2", className)} style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-w-0 rounded-md border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1",
              size === "lg" ? "min-h-12 px-3 py-3 text-base" : size === "sm" ? "min-h-10 break-words px-1.5 py-1.5 text-xs leading-tight" : "px-3 py-2",
              active ? "border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-600" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
