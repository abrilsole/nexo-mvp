"use client";
// ─────────────────────────────────────────────────────────────
// Store global (Zustand). Los datos viven en Supabase: el store los carga
// al entrar (WorkspaceGate), aplica las operaciones puras de lib/ en memoria
// (la UI sigue siendo síncrona) y encola la escritura de lo que cambió.
// Gestión, Taller, Stock y el detalle del proyecto leen SIEMPRE de este mismo estado.
// Sólo el modo Gestión/Taller (y el operario simulado) se guarda en localStorage.
// ─────────────────────────────────────────────────────────────
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AlertSettings,
  CostSettings,
  HourRate,
  AppMode,
  AppRole,
  Attachment,
  MaterialRequest,
  Operator,
  Project,
  ProjectStatus,
  StockLot,
} from "@/types";
import { DEFAULT_HOUR_RATES, DEFAULT_SETTINGS } from "@/lib/constants";
import { costSettingsError, hourRatesError } from "@/lib/cost-settings";
import { buildSeed } from "@/lib/seed-data";
import * as ops from "@/lib/project-operations";
import * as people from "@/lib/operators";
import { createId } from "@/lib/activity";
import { isManager } from "@/lib/project-rules";
import { EMPTY_STOCK, applyChange, receiveStock, type StockState } from "@/lib/stock";
import { materialKey } from "@/lib/material-reconciliation";
import { createClient } from "@/lib/supabase/client";
import { lotToRow } from "@/lib/supabase/mappers";
import * as remote from "@/lib/supabase/workspace";
import { DEFAULT_COST_SETTINGS, type Workspace, type WorkspaceData } from "@/lib/supabase/workspace";
import { tallerCalls } from "@/lib/supabase/taller";

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export type SyncStatus = "idle" | "saving" | "error";

interface AppState {
  projects: Project[];
  operators: Operator[];
  stock: StockState;
  requests: MaterialRequest[];
  settings: AlertSettings;
  /** Multiplicador de horas extra (solo Gestión). */
  costSettings: CostSettings;
  /** Tipos de hora con su tarifa (solo Gestión). */
  hourRates: HourRate[];
  /** La empresa tiene los datos de demostración (solo entonces se ofrece "Restaurar datos demo"). */
  isDemo: boolean;
  currentMode: AppMode;
  resolvedAlertIds: string[];

  /** Empresa y usuario de la sesión (null hasta que carga el workspace). */
  organizationId: string | null;
  organizationName: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  /** Rol real del usuario en la empresa. */
  role: AppRole;
  /** Sólo para Gestión viendo el modo Taller: con qué operario simular el flujo. */
  actingOperatorId: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;

  loadWorkspace: (ws: Workspace) => void;
  setMode: (mode: AppMode) => void;
  setActingOperator: (id: string | null) => void;

  createProject: (input: ops.NewProjectInput) => Result<string>;
  updateProject: (
    id: string,
    patch: Partial<Pick<Project, "name" | "client" | "projectType" | "description" | "dueDate" | "owner" | "salesPrice">>,
  ) => Result;
  changeProjectStatus: (id: string, status: ProjectStatus, opts?: { confirmBack?: boolean }) => Result;
  addBudgetLine: (id: string, input: ops.BudgetLineInput) => Result;
  updateBudgetLine: (id: string, lineId: string, input: ops.BudgetLineInput) => Result;
  removeBudgetLine: (id: string, lineId: string) => Result;
  closeProject: (id: string) => Result;

  addPurchaseEntry: (id: string, input: ops.PurchaseInput) => Result;
  registerUsage: (id: string, input: ops.MaterialUsageInput) => Result;
  logHours: (id: string, input: ops.HoursInput) => Result;
  addActualEntry: (id: string, input: ops.ActualInput) => Result;

  assignOperators: (id: string, operatorIds: string[]) => Result;
  addItem: (id: string, input: { name: string; description?: string; quantity: number }) => Result;
  removeItem: (id: string, itemId: string) => Result;
  addStageLog: (id: string, input: ops.StageLogInput) => Result;
  addAttachment: (id: string, attachment: Attachment) => Result;
  removeAttachment: (id: string, attachmentId: string) => Result;

  assignStock: (input: Parameters<typeof ops.assignStockToProject>[2]) => Result;
  releaseStock: (input: Parameters<typeof ops.releaseProjectStock>[2]) => Result;
  transferStock: (input: Parameters<typeof ops.transferProjectStock>[2]) => Result;
  returnStockToSupplier: (input: Parameters<typeof ops.returnProjectStockToSupplier>[2]) => Result;
  markLeftover: (input: Parameters<typeof ops.leftoverFromProject>[2]) => Result;
  addStockLot: (input: {
    materialId?: string;
    materialName: string;
    unit: string;
    quantity: number;
    unitCost: number;
    supplier?: string;
    location?: string;
    date: string;
    /** "purchase" = compra para el depósito (por defecto) · "opening" = inventario inicial (material que ya tenía). */
    kind?: "purchase" | "opening";
  }) => Result<StockLot>;
  updateLotLocation: (lotId: string, location: string) => Result;

  createOperator: (input: people.OperatorInput) => Result<string>;
  updateOperator: (id: string, input: people.OperatorInput) => Result;
  /**
   * Baja lógica: el operario deja de aparecer en equipos y Taller. Sus horas se conservan.
   * `plan` da destino a cada proyecto no finalizado donde estaba asignado (otro operario o null = "Sin asignar").
   */
  deactivateOperator: (id: string, plan?: people.ReassignmentPlan) => Result;
  reactivateOperator: (id: string) => Result;
  /** Solo si no tiene horas registradas. */
  deleteOperator: (id: string) => Result;
  createMaterialRequest: (input: {
    projectId: string;
    materialId: string;
    materialName: string;
    unit: string;
    quantity: number;
    note?: string;
  }) => Result;
  setRequestStatus: (id: string, status: "resolved" | "cancelled") => Result;

  /** Recibe Alert.resolutionKey: si el problema persiste, la alerta reaparece. */
  resolveAlert: (alertId: string) => void;
  reopenAlert: (alertId: string) => void;
  updateSettings: (patch: Partial<AlertSettings>) => void;
  updateCostSettings: (patch: Partial<CostSettings>) => Result;
  /** Guarda las tarifas. Las cotizaciones ya guardadas conservan la tarifa con la que se hicieron. */
  saveHourRates: (rates: HourRate[]) => Result;
  /** Reemplaza los datos de la empresa por la demo de Madera Sur. */
  resetDemo: () => Promise<Result>;
  /** Borra todos los datos de la empresa para empezar de cero. */
  clearData: () => Promise<Result>;
  dismissSyncError: () => void;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Ocurrió un error inesperado.";
}

export function demoData(): WorkspaceData {
  const seed = buildSeed(new Date());
  return {
    projects: seed.projects,
    operators: seed.operators,
    stock: seed.stock,
    requests: [],
    settings: { ...DEFAULT_SETTINGS },
    resolvedAlertIds: [],
  };
}

const EMPTY_DATA: WorkspaceData = {
  projects: [],
  operators: [],
  stock: EMPTY_STOCK,
  requests: [],
  settings: { ...DEFAULT_SETTINGS },
  resolvedAlertIds: [],
};

/** Quién está operando realmente: el rol de la cuenta o, en modo Taller, un operario. */
export function effectiveIdentity(s: Pick<AppState, "role" | "currentMode" | "operators" | "userId" | "userEmail" | "actingOperatorId" | "userName">): {
  role: AppRole;
  operator: Operator | undefined;
  actor: string;
} {
  if (s.role === "operator") {
    const operator = people.operatorForUser(s.operators, s.userId, s.userEmail);
    return { role: "operator", operator, actor: operator?.name ?? s.userName };
  }
  if (s.currentMode === "workshop") {
    const operator = s.operators.find((o) => o.id === s.actingOperatorId && o.active);
    return { role: "operator", operator, actor: operator?.name ?? s.userName };
  }
  return { role: s.role, operator: undefined, actor: s.userName };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => {
      const ctx = (): ops.Ctx => {
        const id = effectiveIdentity(get());
        return { actor: id.actor, now: new Date().toISOString(), role: id.role, operatorId: id.operator?.id };
      };

      // Cola de escrituras: se ejecutan en orden para que un proyecto exista antes que sus hijos.
      let queue: Promise<unknown> = Promise.resolve();
      let pending = 0;
      const persistRemote = (write: (db: ReturnType<typeof createClient>, org: string) => Promise<unknown>) => {
        const org = get().organizationId;
        if (!org) return queue;
        pending += 1;
        set({ syncStatus: "saving" });
        queue = queue
          .then(() => write(createClient(), org))
          .then(
            () => {
              pending -= 1;
              if (pending === 0 && get().syncStatus === "saving") set({ syncStatus: "idle" });
            },
            (e: unknown) => {
              pending -= 1;
              set({ syncStatus: "error", syncError: `No se pudo guardar: ${errorMessage(e)}. Recargá la página para ver el estado guardado.` });
            },
          );
        return queue;
      };

      /** Guarda en memoria lo que cambió y encola su escritura. Todas las vistas leen de acá. */
      const commit = (next: { projects?: Project[]; stock?: StockState; operators?: Operator[]; requests?: MaterialRequest[] }) => {
        const prev = get();
        const projects = next.projects ?? prev.projects;
        const stock = next.stock ?? prev.stock;
        const operators = next.operators ?? prev.operators;
        const requests = next.requests ?? prev.requests;
        set({ projects, stock, operators, requests });
        if (prev.role === "operator") {
          // Taller no escribe tablas: cada registro nuevo va a su función del servidor (que calcula los costos).
          const calls = tallerCalls({ projects: prev.projects, stock: prev.stock, requests: prev.requests }, { projects, stock, requests }, prev.organizationId ?? "");
          void persistRemote((db) => remote.runTallerCalls(db, calls));
          return;
        }
        void persistRemote(async (db, org) => {
          for (const p of projects) {
            const before = prev.projects.find((x) => x.id === p.id);
            if (before !== p) await remote.syncProject(db, org, before, p);
          }
          await remote.syncStock(db, org, prev.stock, stock);
          await remote.syncOperators(db, org, prev.operators, operators);
          await remote.syncRequests(db, org, prev.requests, requests);
        });
      };

      /** Corre una operación y devuelve Result (nunca lanza). */
      const run = <T,>(fn: () => T): Result<T> => {
        try {
          return { ok: true, value: fn() };
        } catch (e) {
          return { ok: false, error: errorMessage(e) };
        }
      };

      const find = (id: string): Project => {
        const project = get().projects.find((p) => p.id === id);
        if (!project) throw new ops.DomainError("Proyecto no encontrado.");
        return project;
      };

      const requireManager = (what: string) => {
        if (!isManager(effectiveIdentity(get()).role)) throw new ops.DomainError(`${what} lo hace Gestión.`);
      };

      /** Aplica una operación pura sobre un proyecto. */
      const mutate = (id: string, fn: (p: Project) => Project): Result =>
        run(() => {
          const project = find(id);
          const next = fn(project);
          commit({ projects: get().projects.map((p) => (p.id === id ? next : p)) });
          return undefined;
        });

      /** Aplica una operación que toca proyectos y stock a la vez. */
      const mutateStock = (fn: (s: ReturnType<typeof get>) => { projects: Project[]; stock: StockState }): Result =>
        run(() => {
          const res = fn(get());
          commit({ projects: res.projects, stock: res.stock });
          return undefined;
        });

      /** Reemplaza todos los datos de la empresa (reset demo / vaciar). Espera a las escrituras previas. */
      const replaceAll = (data: WorkspaceData, isDemo: boolean): Promise<Result> => {
        const org = get().organizationId;
        if (!org) return Promise.resolve({ ok: false, error: "Todavía no cargó tu empresa." });
        set({ syncStatus: "saving" });
        const run2 = queue.then(async (): Promise<Result> => {
          try {
            await remote.replaceWorkspace(createClient(), org, isDemo ? data : null);
            set({ ...data, isDemo, currentMode: "management", actingOperatorId: null, syncStatus: "idle", syncError: null });
            return { ok: true, value: undefined };
          } catch (e) {
            set({ syncStatus: "error", syncError: `No se pudo guardar: ${errorMessage(e)}` });
            return { ok: false, error: errorMessage(e) };
          }
        });
        queue = run2;
        return run2;
      };

      return {
        ...EMPTY_DATA,
        costSettings: { ...DEFAULT_COST_SETTINGS },
        hourRates: DEFAULT_HOUR_RATES.map((r) => ({ ...r })),
        isDemo: false,
        currentMode: "management",
        organizationId: null,
        organizationName: "",
        userId: null,
        userName: "",
        userEmail: "",
        role: "owner",
        actingOperatorId: null,
        syncStatus: "idle",
        syncError: null,

        loadWorkspace: (ws) => {
          set({
            projects: ws.projects,
            operators: ws.operators,
            stock: ws.stock,
            requests: ws.requests,
            settings: ws.settings,
            costSettings: ws.costSettings,
            hourRates: ws.hourRates,
            isDemo: ws.isDemo,
            resolvedAlertIds: ws.resolvedAlertIds,
            organizationId: ws.organizationId,
            organizationName: ws.organizationName,
            userId: ws.userId,
            userName: ws.userName,
            userEmail: ws.userEmail,
            role: ws.role,
            // Un operario real siempre ve Taller.
            currentMode: ws.role === "operator" ? "workshop" : get().currentMode,
            syncStatus: "idle",
            syncError: null,
          });
          // Datos del modelo anterior: el ledger derivado se guarda una sola vez.
          if (ws.stockMigrated) void persistRemote((db, org) => remote.syncStock(db, org, EMPTY_STOCK, ws.stock));
        },

        setMode: (mode) => set({ currentMode: get().role === "operator" ? "workshop" : mode }),
        setActingOperator: (id) => set({ actingOperatorId: id }),

        createProject: (input) =>
          run(() => {
            requireManager("Crear proyectos");
            const project = ops.createProject(input, ctx());
            commit({ projects: [project, ...get().projects] });
            return project.id;
          }),

        updateProject: (id, patch) =>
          mutate(id, (p) => {
            requireManager("Editar el proyecto");
            return { ...p, ...patch, updatedAt: new Date().toISOString() };
          }),

        changeProjectStatus: (id, status, opts) => mutate(id, (p) => ops.changeStatus(p, status, ctx(), opts)),

        addBudgetLine: (id, input) =>
          mutate(id, (p) => {
            requireManager("Editar el costo presupuestado");
            return ops.addBudgetLine(p, input, ctx());
          }),
        updateBudgetLine: (id, lineId, input) =>
          mutate(id, (p) => {
            requireManager("Editar el costo presupuestado");
            return ops.updateBudgetLine(p, lineId, input, ctx());
          }),
        removeBudgetLine: (id, lineId) =>
          mutate(id, (p) => {
            requireManager("Editar el costo presupuestado");
            return ops.removeBudgetLine(p, lineId, ctx());
          }),

        closeProject: (id) =>
          run(() => {
            const project = find(id);
            const closed = ops.closeProject(project, get().stock, ctx());
            commit({ projects: get().projects.map((p) => (p.id === id ? closed : p)) });
            return undefined;
          }),

        addPurchaseEntry: (id, input) =>
          run(() => {
            const project = find(id);
            const res = ops.addPurchase(project, get().stock, input, ctx());
            commit({ projects: get().projects.map((p) => (p.id === id ? res.project : p)), stock: res.stock });
            return undefined;
          }),

        registerUsage: (id, input) =>
          run(() => {
            const project = find(id);
            const res = ops.registerUsage(project, get().stock, input, get().settings, ctx());
            commit({ projects: get().projects.map((p) => (p.id === id ? res.project : p)), stock: res.stock });
            return undefined;
          }),

        logHours: (id, input) => mutate(id, (p) => ops.logHours(p, get().operators, input, get().settings, ctx())),

        addActualEntry: (id, input) => mutate(id, (p) => ops.addActual(p, input, get().settings, ctx())),

        assignOperators: (id, operatorIds) => mutate(id, (p) => ops.assignOperators(p, operatorIds, get().operators, ctx())),
        addItem: (id, input) => mutate(id, (p) => ops.addItem(p, input, ctx())),
        removeItem: (id, itemId) => mutate(id, (p) => ops.removeItem(p, itemId, ctx())),
        addStageLog: (id, input) => mutate(id, (p) => ops.addStageLog(p, input, ctx()).project),
        addAttachment: (id, attachment) => mutate(id, (p) => ops.addAttachment(p, attachment, ctx())),
        removeAttachment: (id, attachmentId) => mutate(id, (p) => ops.removeAttachment(p, attachmentId, ctx())),

        assignStock: (input) => mutateStock((s) => ops.assignStockToProject(s.projects, s.stock, input, ctx())),
        releaseStock: (input) => mutateStock((s) => ops.releaseProjectStock(s.projects, s.stock, input, ctx())),
        transferStock: (input) => mutateStock((s) => ops.transferProjectStock(s.projects, s.stock, input, ctx())),
        returnStockToSupplier: (input) => mutateStock((s) => ops.returnProjectStockToSupplier(s.projects, s.stock, input, ctx())),
        markLeftover: (input) => mutateStock((s) => ops.leftoverFromProject(s.projects, s.stock, input, ctx())),

        addStockLot: (input) =>
          run(() => {
            requireManager("Registrar compras de stock");
            const c = ctx();
            const received = receiveStock(
              {
                materialId: materialKey(input.materialId, input.materialName),
                materialName: input.materialName,
                unit: input.unit,
                quantity: input.quantity,
                unitCost: input.unitCost,
                supplier: input.supplier,
                location: input.location,
                date: input.date,
                destination: "warehouse",
                kind: input.kind ?? "purchase",
              },
              c,
            );
            commit({ stock: applyChange(get().stock, received) });
            return received.lot;
          }),

        updateLotLocation: (lotId, location) =>
          run(() => {
            requireManager("Editar la ubicación");
            const stock = get().stock;
            // La ubicación es un dato del lote, no un movimiento: se reemplaza el lote (el ledger no cambia).
            const next = { ...stock, lots: stock.lots.map((l) => (l.id === lotId ? { ...l, location: location.trim() || undefined } : l)) };
            set({ stock: next });
            const lot = next.lots.find((l) => l.id === lotId);
            if (lot) {
              void persistRemote(async (db, org) => {
                const res = await db.from("stock_lots").upsert(lotToRow(org, lot), { onConflict: "organization_id,id" });
                if (res.error) throw new Error(res.error.message);
              });
            }
            return undefined;
          }),

        createOperator: (input) =>
          run(() => {
            requireManager("Cargar operarios");
            const operator = people.createOperator(input, new Date().toISOString());
            commit({ operators: [...get().operators, operator] });
            return operator.id;
          }),

        updateOperator: (id, input) =>
          run(() => {
            requireManager("Editar operarios");
            commit({ operators: people.updateOperator(get().operators, id, input) });
            return undefined;
          }),

        deactivateOperator: (id, plan = {}) =>
          run(() => {
            requireManager("Dar de baja operarios");
            const { operators, projects } = get();
            const planError = people.reassignmentPlanError(operators, projects, id, plan);
            if (planError) throw new ops.DomainError(planError);
            const open = new Set(people.openProjectsOf(projects, id).map((p) => p.id));
            const c = ctx();
            commit({
              projects: projects.map((p) => (open.has(p.id) ? ops.reassignForDeactivation(p, id, plan[p.id] ?? null, operators, c) : p)),
              operators: people.deactivateOperator(operators, id, c.now),
            });
            if (get().actingOperatorId === id) set({ actingOperatorId: null });
            return undefined;
          }),

        reactivateOperator: (id) =>
          run(() => {
            requireManager("Reactivar operarios");
            commit({ operators: people.reactivateOperator(get().operators, id) });
            return undefined;
          }),

        deleteOperator: (id) =>
          run(() => {
            requireManager("Eliminar operarios");
            const next = people.deleteOperator(get().operators, get().projects, id);
            commit(next);
            if (get().actingOperatorId === id) set({ actingOperatorId: null });
            return undefined;
          }),

        createMaterialRequest: (input) =>
          run(() => {
            const project = find(input.projectId);
            if (!(input.quantity > 0)) throw new ops.DomainError("Indicá cuánto material falta.");
            const identity = effectiveIdentity(get());
            if (identity.role === "operator" && !(identity.operator && project.assignedOperatorIds.includes(identity.operator.id))) {
              throw new ops.DomainError("No estás asignado a este proyecto.");
            }
            const request: MaterialRequest = {
              id: createId("req"),
              projectId: project.id,
              materialId: input.materialId,
              materialName: input.materialName,
              quantity: input.quantity,
              unit: input.unit,
              note: input.note?.trim() || undefined,
              requestedBy: identity.actor,
              status: "open",
              createdAt: new Date().toISOString(),
            };
            commit({ requests: [request, ...get().requests] });
            return undefined;
          }),

        setRequestStatus: (id, status) =>
          run(() => {
            requireManager("Resolver pedidos de material");
            const now = new Date().toISOString();
            const actor = effectiveIdentity(get()).actor;
            commit({
              requests: get().requests.map((q) => (q.id === id ? { ...q, status, resolvedAt: now, resolvedBy: actor } : q)),
            });
            return undefined;
          }),

        resolveAlert: (alertId) => {
          if (get().resolvedAlertIds.includes(alertId)) return;
          set({ resolvedAlertIds: [...get().resolvedAlertIds, alertId] });
          void persistRemote((db, org) => remote.setAlertResolved(db, org, alertId, true));
        },
        reopenAlert: (alertId) => {
          set({ resolvedAlertIds: get().resolvedAlertIds.filter((a) => a !== alertId) });
          void persistRemote((db, org) => remote.setAlertResolved(db, org, alertId, false));
        },

        updateSettings: (patch) => {
          const settings = { ...get().settings, ...patch };
          set({ settings });
          void persistRemote((db, org) => remote.saveSettings(db, org, settings));
        },

        updateCostSettings: (patch) => {
          const costSettings = { ...get().costSettings, ...patch };
          const error = costSettingsError(costSettings);
          if (error) return { ok: false, error };
          set({ costSettings });
          void persistRemote((db, org) => remote.saveCostSettings(db, org, costSettings));
          return { ok: true, value: undefined };
        },
        saveHourRates: (rates) => {
          const error = hourRatesError(rates);
          if (error) return { ok: false, error };
          const hourRates = rates.map((r) => ({ ...r }));
          set({ hourRates });
          void persistRemote((db, org) => remote.saveHourRates(db, org, hourRates));
          return { ok: true, value: undefined };
        },

        resetDemo: () => replaceAll(demoData(), true),
        clearData: () => replaceAll({ ...EMPTY_DATA, settings: { ...DEFAULT_SETTINGS } }, false),
        dismissSyncError: () => set({ syncError: null, syncStatus: "idle" }),
      };
    },
    {
      name: "nexo-ui-v2",
      version: 3,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ currentMode: s.currentMode, actingOperatorId: s.actingOperatorId }),
    },
  ),
);

export function useProject(id: string): Project | undefined {
  return useAppStore((s) => s.projects.find((p) => p.id === id));
}
