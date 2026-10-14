"use client";
// Campos chicos de la calculadora (números como texto para permitir vacíos).
import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTip } from "@/components/ui/help-tip";

export const NumField = ({
  id,
  label,
  value,
  onChange,
  suffix,
  placeholder,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
  /** Explicación en una ⓘ al lado de la etiqueta (la etiqueta queda corta). */
  help?: ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>
      {help && <HelpTip label={label}>{help}</HelpTip>}
    </div>
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder ?? "0"}
        onChange={(e) => onChange(e.target.value)}
        className={suffix ? "pr-9 text-right" : "text-right"}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
    </div>
  </div>
);

export const TextField = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  list,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  list?: string;
}) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>
    <Input id={id} value={value} list={list} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </div>
);

export const RemoveButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} className="self-end">
    <Trash2 />
  </Button>
);

/** Bloque de la calculadora con título y, si hace falta, una ⓘ con la explicación. */
export function Section({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label={title}>
      <div className="mb-3 flex items-center gap-1">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {help && <HelpTip label={title}>{help}</HelpTip>}
      </div>
      {children}
    </section>
  );
}
