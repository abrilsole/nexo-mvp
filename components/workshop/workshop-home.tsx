"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { activeOperators, operatorAccessForUser, projectsForOperator } from "@/lib/operators";
import { useAppStore } from "@/store/use-app-store";
import { useIdentity } from "@/store/selectors";
import { StatusBadge } from "@/components/shared/badges";
import { ModeSwitch } from "@/components/layout/mode-switch";
import { Select } from "@/components/ui/input";

/** Inicio del Operario ("Mi día"): sólo los proyectos activos, en etapa de ejecución, asignados al operario. Sin plata. */
export function WorkshopHome() {
  const projects = useAppStore((s) => s.projects);
  const operators = useAppStore((s) => s.operators);
  const setActingOperator = useAppStore((s) => s.setActingOperator);
  const userId = useAppStore((s) => s.userId);
  const userEmail = useAppStore((s) => s.userEmail);
  const isDemo = useAppStore((s) => s.isDemo);
  const { operator, realRole } = useIdentity();
  const isRealOperator = realRole === "operator";
  const mine = operator ? projectsForOperator(projects, operator.id, operators) : [];
  const access = isRealOperator ? operatorAccessForUser(operators, userId, userEmail) : null;

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white px-4 pb-10">
      <header className="flex items-center justify-between py-4">
        <div>
          <div className="text-lg font-semibold tracking-tight">{APP_NAME}</div>
          <div className="text-xs text-slate-500">Operario{operator ? ` · ${operator.name}` : ""}</div>
        </div>
        {isRealOperator && (
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-blue-700">Cerrar sesión</button>
          </form>
        )}
      </header>

      {!isRealOperator && isDemo && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label htmlFor="acting-op" className="mb-1.5 block text-xs font-medium text-slate-600">Ver la demo como el operario</label>
          <Select id="acting-op" value={operator?.id ?? ""} onChange={(e) => setActingOperator(e.target.value || null)}>
            <option value="">Elegí un operario…</option>
            {activeOperators(operators).map((o) => (
              <option key={o.id} value={o.id}>{o.name} · {o.role}</option>
            ))}
          </Select>
        </div>
      )}

      {!operator ? (
        <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-900">
          {access === "deactivated"
            ? "Tu usuario está dado de baja como operario, así que no ves proyectos. Si es un error, pedile a un usuario Administrativo que te reactive."
            : isRealOperator
            ? "Tu usuario todavía no está vinculado a un operario. Pedile a un usuario Administrativo que te invite desde Configuración → Usuarios."
            : isDemo
            ? "Elegí un operario para ver lo que vería en su día."
            : "Esta pantalla es la de los operarios."}
        </p>
      ) : (
        <>
          <h1 className="mb-3 text-xl font-semibold">¿En qué proyecto trabajás?</h1>
          {mine.length === 0 ? (
            <p className="rounded-md bg-slate-100 p-4 text-sm text-slate-700">No tenés proyectos activos asignados por ahora.</p>
          ) : (
            <ul className="space-y-2">
              {mine.map((p) => (
                <li key={p.id}>
                  <Link href={`/taller/${p.id}`} className="flex min-h-16 items-center gap-3 rounded-lg border border-slate-200 p-4 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-slate-500">{p.code}</div>
                      <div className="break-words font-medium text-slate-900">{p.name}</div>
                    </div>
                    <StatusBadge status={p.status} />
                    <ChevronRight className="size-5 text-slate-400" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!isRealOperator && isDemo && (
        <div className="mt-8 border-t border-slate-200 pt-4">
          <ModeSwitch />
        </div>
      )}
    </div>
  );
}
