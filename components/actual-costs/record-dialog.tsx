"use client";
import { useState } from "react";
import { ArrowLeft, Briefcase, Clock, Hammer, Landmark, Package, PenTool, Truck, Wrench, Zap } from "lucide-react";
import type { ActualEntryType, Project } from "@/types";
import { ACTUAL_TYPE_LABELS, CATEGORY_LABELS, OTHER_COST_CATEGORIES, type OtherCostCategory } from "@/lib/constants";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UsageForm } from "@/components/materials/usage-form";
import { HoursForm } from "./hours-form";
import { canExecute } from "@/lib/project-rules";
import { STATUS_LABELS } from "@/lib/constants";
import { OtherCostForm } from "./other-cost-form";

/** Diseño, Administración y Gasto financiero se registran como tipo "other" con su categoría. */
type Kind = "material" | "labor" | Exclude<ActualEntryType, "finishing" | "labor" | "other"> | OtherCostCategory;

/** Una tarjeta por tipo de registro; cubren las siete categorías de reporte. El uso de máquina va dentro de las horas. */
const CARDS: Array<{ kind: Kind; label: string; icon: typeof Package }> = [
  { kind: "material", label: "Material utilizado", icon: Package },
  { kind: "labor", label: ACTUAL_TYPE_LABELS.labor, icon: Clock },
  { kind: "outsourcing", label: ACTUAL_TYPE_LABELS.outsourcing, icon: Hammer },
  { kind: "installation", label: ACTUAL_TYPE_LABELS.installation, icon: Wrench },
  { kind: "design", label: CATEGORY_LABELS.design, icon: PenTool },
  { kind: "admin", label: CATEGORY_LABELS.admin, icon: Briefcase },
  { kind: "logistics", label: ACTUAL_TYPE_LABELS.logistics, icon: Truck },
  { kind: "financial", label: CATEGORY_LABELS.financial, icon: Landmark },
  { kind: "unexpected", label: ACTUAL_TYPE_LABELS.unexpected, icon: Zap },
];

const isOtherCostKind = (k: Kind): k is OtherCostCategory => (OTHER_COST_CATEGORIES as readonly string[]).includes(k);
const kindTitle = (k: Exclude<Kind, "material">) => (isOtherCostKind(k) ? CATEGORY_LABELS[k] : ACTUAL_TYPE_LABELS[k]);

export function RecordDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const close = () => {
    onOpenChange(false);
    setKind(null);
  };
  const title = kind === null ? "Registrar lo que pasó" : kind === "material" ? "Material utilizado" : kindTitle(kind);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setKind(null);
      }}
    >
      <DialogContent side="right">
        <DialogHeader>
          {kind !== null && (
            <button type="button" onClick={() => setKind(null)} className="mb-1 inline-flex items-center gap-1 self-start text-sm text-blue-700">
              <ArrowLeft className="size-4" /> Cambiar tipo
            </button>
          )}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {project.code} · {project.name}
          </DialogDescription>
        </DialogHeader>
        {!canExecute(project.status) ? (
          <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-900" role="alert">
            Este proyecto está en {STATUS_LABELS[project.status]}: todavía no admite consumo de material, horas ni costos de ejecución. Pasalo a Compras para empezar.
          </p>
        ) : kind === null ? (
          <div>
            <p className="mb-3 font-medium text-slate-800">¿Qué querés registrar?</p>
            <div className="grid grid-cols-2 gap-3">
              {CARDS.map((c) => (
                <button
                  key={c.kind}
                  type="button"
                  onClick={() => setKind(c.kind)}
                  className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50/40"
                >
                  <c.icon className="size-5 text-blue-700" aria-hidden />
                  <span className="text-sm font-medium text-slate-900">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : kind === "material" ? (
          <UsageForm project={project} onDone={close} variant="management" />
        ) : kind === "labor" ? (
          <HoursForm project={project} onDone={close} variant="management" />
        ) : (
          <OtherCostForm project={project} cost={isOtherCostKind(kind) ? { type: "other", category: kind } : { type: kind }} onDone={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
