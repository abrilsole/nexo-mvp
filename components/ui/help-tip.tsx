"use client";
// Ayuda ⓘ accesible: un botón que abre una explicación con clic, tap o teclado (Enter / Espacio),
// se cierra con Escape (el foco vuelve al botón), con el botón "Cerrar" o tocando afuera.
// En el celular la explicación aparece abajo, a lo ancho de la pantalla.
import * as React from "react";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function HelpTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const wrapper = React.useRef<HTMLSpanElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);

  const close = React.useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  return (
    <span ref={wrapper} className={cn("relative inline-flex align-middle", className)}>
      <button
        ref={button}
        type="button"
        aria-label={`Ayuda: ${label}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <Info className="size-4" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          aria-label={label}
          className="fixed inset-x-4 bottom-4 z-50 block rounded-lg bg-slate-900 p-3 text-left text-xs font-normal leading-relaxed text-white shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-80"
        >
          <span className="mb-1 flex items-start justify-between gap-2">
            <strong className="text-sm font-semibold">{label}</strong>
            <button type="button" onClick={() => close(true)} aria-label="Cerrar ayuda" className="-m-1 rounded p-1 text-slate-300 hover:text-white">
              <X className="size-4" aria-hidden />
            </button>
          </span>
          <span className="block space-y-1">{children}</span>
        </span>
      )}
    </span>
  );
}
