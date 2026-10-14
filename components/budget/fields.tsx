"use client";
// Campos chicos de la calculadora (números como texto para permitir vacíos).
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  help?: string;
}) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>
    <div className="relative">
      <Input
        id={id}
        aria-describedby={help ? `${id}-help` : undefined}
        inputMode="decimal"
        value={value}
        placeholder={placeholder ?? "0"}
        onChange={(e) => onChange(e.target.value)}
        className={suffix ? "pr-9 text-right" : "text-right"}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
    </div>
    {help && <p id={`${id}-help`} className="text-[11px] text-slate-500">{help}</p>}
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
