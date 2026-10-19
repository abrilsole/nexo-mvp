"use client";
import { useCallback, useEffect, useState } from "react";
import { APP_NAME } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { loadWorkspace, replaceWorkspace } from "@/lib/supabase/workspace";
import { demoData, useAppStore } from "@/store/use-app-store";

type GateState = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

/**
 * Carga la empresa del usuario desde Supabase antes de renderizar la app.
 * La primera vez que entra alguien, su empresa (creada por un trigger al registrarse)
 * todavía no tiene datos: le cargamos la demo de Madera Sur.
 */
export function HydrationGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      void useAppStore.persist.rehydrate();
      const db = createClient();
      let ws = await loadWorkspace(db);
      if (!ws.demoSeeded) {
        await replaceWorkspace(db, ws.organizationId, demoData());
        ws = await loadWorkspace(db);
      }
      useAppStore.getState().loadWorkspace(ws);
      setState({ status: "ready" });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "No pudimos cargar tus datos." });
    }
  }, []);

  useEffect(() => {
    // Carga inicial desde Supabase: el setState ocurre después del await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void useAppStore.getState().refreshWorkspace().catch(() => {
        useAppStore.setState({ syncStatus: "error", syncError: "No pudimos actualizar los datos. Revisá la conexión y reintentá." });
      });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [state.status]);

  if (state.status === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <span className="text-lg font-semibold tracking-tight text-slate-900">{APP_NAME}</span>
        <p role="alert" className="max-w-sm text-sm text-slate-600">
          {state.message}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Reintentar
          </button>
          <form action="/auth/signout" method="post">
            <button type="submit" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" aria-busy="true">
        <span className="font-semibold tracking-tight text-slate-900">{APP_NAME}</span>
        <span className="ml-2">cargando tus proyectos…</span>
      </div>
    );
  }

  return (
    <>
      {children}
      <SyncToast />
    </>
  );
}

function SyncToast() {
  const status = useAppStore((s) => s.syncStatus);
  const error = useAppStore((s) => s.syncError);
  const dismiss = useAppStore((s) => s.dismissSyncError);
  if (status === "error" && error) {
    return (
      <div role="alert" className="fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,32rem)] -translate-x-1/2 items-start gap-3 rounded-lg bg-red-700 px-4 py-3 text-sm text-white shadow-lg">
        <span className="flex-1">{error}</span>
        <button type="button" onClick={dismiss} className="font-medium underline underline-offset-2">
          Actualizar
        </button>
      </div>
    );
  }
  if (status === "saving") {
    return (
      <div role="status" className="fixed bottom-4 right-4 z-[60] rounded-full bg-slate-900/90 px-3 py-1.5 text-xs font-medium text-white shadow">
        Guardando…
      </div>
    );
  }
  return null;
}
