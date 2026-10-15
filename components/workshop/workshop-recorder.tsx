"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, NotebookPen, Package, PackagePlus } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { projectsForOperator } from "@/lib/operators";
import { useAppStore, useProject } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { Button } from "@/components/ui/button";
import { UsageForm } from "@/components/materials/usage-form";
import { MaterialRequestForm } from "./material-request-form";
import { StageNoteForm } from "./stage-note-form";

// Las horas se cargan en "Mi día" (Lote 5B): acá quedan las otras cargas.
type View = "menu" | "material" | "request" | "note" | "done";

/** Registro de Taller: sin plata, sólo lo que el operario asignado puede hacer en un proyecto en ejecución. */
export function WorkshopRecorder({ projectId }: { projectId: string }) {
  const project = useProject(projectId);
  const projects = useAppStore((s) => s.projects);
  const { operator } = useIdentity();
  const [view, setView] = useState<View>("menu");
  const [lastSummary, setLastSummary] = useState("");

  const operators = useAppStore((s) => s.operators);
  const allowed = project && operator ? projectsForOperator(projects, operator.id, operators).some((p) => p.id === project.id) : false;

  if (!project || !allowed) {
    return (
      <Shell>
        <p className="py-10 text-center text-slate-600">
          {!operator
            ? "Entrá desde “Mi día” para continuar."
            : "No tenés acceso a este proyecto: no está activo en ejecución o no estás asignado."}
        </p>
      </Shell>
    );
  }

  const done = (summary: string) => {
    setLastSummary(summary);
    setView("done");
    window.scrollTo({ top: 0 });
  };

  return (
    <Shell>
      <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="text-sm font-medium text-slate-500">Proyecto {project.code}</div>
        <div className="text-lg font-semibold leading-snug text-slate-900">{project.name}</div>
      </div>

      {view === "menu" ? (
        <div>
          <h1 className="mb-4 text-2xl font-semibold">¿Qué querés registrar?</h1>
          <div className="grid gap-3">
            <BigOption icon={Package} label="Material usado" hint="Lo que usaste, desperdicio y sobrante" onClick={() => setView("material")} />
            <BigOption icon={PackagePlus} label="Solicitar material" hint="Avisá qué te falta" onClick={() => setView("request")} />
            <BigOption icon={NotebookPen} label="Nota o incidencia" hint="Con foto si hace falta" onClick={() => setView("note")} />
          </div>
        </div>
      ) : view === "done" ? (
        <div className="flex flex-col items-center py-8 text-center" role="status">
          <CheckCircle2 className="mb-3 size-16 text-emerald-600" aria-hidden />
          <h1 className="text-2xl font-semibold">Registrado correctamente</h1>
          <p className="mt-2 text-slate-600">{lastSummary}</p>
          <Button size="xl" className="mt-8 w-full" onClick={() => setView("menu")}>
            Registrar otra cosa
          </Button>
        </div>
      ) : (
        <div>
          <button type="button" onClick={() => setView("menu")} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-blue-700">
            <ArrowLeft className="size-4" /> Volver
          </button>
          {view === "material" && <UsageForm project={project} variant="workshop" onDone={done} onRequestMaterial={() => setView("request")} />}
          {view === "request" && <MaterialRequestForm project={project} onDone={done} />}
          {view === "note" && <StageNoteForm project={project} onDone={done} />}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-md px-4 pb-16">
        <header className="flex items-center justify-between py-4">
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
          <Link href="/taller" className="text-sm text-blue-700">
            Mi día
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}

function BigOption({ icon: Icon, label, hint, onClick }: { icon: typeof Package; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-20 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm active:bg-slate-50">
      <span className="flex size-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
        <Icon className="size-6" aria-hidden />
      </span>
      <span>
        <span className="block text-lg font-semibold text-slate-900">{label}</span>
        <span className="block text-sm text-slate-500">{hint}</span>
      </span>
    </button>
  );
}
