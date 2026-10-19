"use client";
// ─────────────────────────────────────────────────────────────
// Store global (Zustand). Los datos viven en Supabase: el store los carga
// al entrar (WorkspaceGate), aplica las operaciones puras de lib/ en memoria
// y encola la escritura de lo que cambió. Las acciones confirmadas esperan
// la persistencia y reconcilian el estado antes de permitir otra operación.
// Todas las pantallas leen SIEMPRE de este mismo estado.
// Sólo el rol elegido en la demo (y el operario simulado) se guarda en localStorage.
// ─────────────────────────────────────────────────────────────
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  AlertSettings,
  CostSettings,
  DayException,
  HourRate,
  AppRole,
  Attachment,
  MaterialRequest,
  Operator,
  PriceRecord,
  Project,
  PurchaseOrder,
  ProjectStatus,
  RubroId,
  StockLot,
  ValueCorrection,
  WorkAssignment,
} from "@/types";
import { DEFAULT_HOUR_RATES, DEFAULT_SETTINGS, DEMO_USERS } from "@/lib/constants";
import { roleKeyOf, type RoleKey } from "@/lib/permissions";
import { costSettingsError, hourRatesError } from "@/lib/cost-settings";
import { buildSeed } from "@/lib/seed-data";
import * as ops from "@/lib/project-operations";
import * as people from "@/lib/operators";
import { createId } from "@/lib/activity";
import { checkHours, isBuyer, isManager } from "@/lib/project-rules";
import type { ProductInput } from "@/lib/production";
import { EMPTY_STOCK, applyChange, receiveStock, type StockState } from "@/lib/stock";
import { materialKey } from "@/lib/material-reconciliation";
import { createClient } from "@/lib/supabase/client";
import { lotToRow } from "@/lib/supabase/mappers";
import * as remote from "@/lib/supabase/workspace";
import { DEFAULT_COST_SETTINGS, type ScheduleChange, type Workspace, type WorkspaceData } from "@/lib/supabase/workspace";
import { exceptionError, workDaysError } from "@/lib/schedule";
import { tallerCalls } from "@/lib/supabase/taller";
import {
  invoiceActivity,
  invoiceEntries,
  invoiceError,
  nextOrderNumber,
  orderDraftError,
  receiveOrder as receiveOrderLines,
  type InvoiceInput,
  type OrderDraft,
  type ReceiptInput,
} from "@/lib/purchasing";
import { todayISO } from "@/lib/formatting";
import { hourRatesAt, laborCostAt, OVERTIME_SUBJECT, priceChange, priceChangeError, valueAt } from "@/lib/price-history";
import { applyCorrection, correctionError, type CorrectionInput } from "@/lib/corrections";
import { assignmentError, type AssignmentInput } from "@/lib/plant";

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export type SyncStatus = "idle" | "saving" | "error";

interface AppState {
  reviewedHoursKeys: string[];
  projects: Project[];
  /** Asignaciones del Jefe de planta (Lote 5B). */
  assignments: WorkAssignment[];
  /** Estado de compra de las líneas de materiales (Lote 5C). */
  /** Órdenes de compra (Lote 6). Las ven Administrativo y Compras. */
  orders: PurchaseOrder[];
  /** Excepciones de días laborales (Lote 6 · Fase 3). */
  dayExceptions: DayException[];
  operators: Operator[];
  stock: StockState;
  requests: MaterialRequest[];
  settings: AlertSettings;
  /** Multiplicador de horas extra (solo Gestión). */
  costSettings: CostSettings;
  /** Tipos de hora con la tarifa vigente hoy (solo Administrativo). */
  hourRates: HourRate[];
  /** Historial de precios con vigencia (Administrativo: todo · Compras: precios de materiales). */
  priceHistory: PriceRecord[];
  /** Correcciones auditadas de valores congelados (solo Administrativo). */
  corrections: ValueCorrection[];
  /** La empresa tiene los datos de demostración (solo entonces se ofrece "Restaurar datos demo"). */
  isDemo: boolean;
  /** Solo en una empresa demo y para Administrativo: con qué rol se está mirando la app. */
  currentMode: RoleKey;
  resolvedAlertIds: string[];

  /** Empresa y usuario de la sesión (null hasta que carga el workspace). */
  organizationId: string | null;
  organizationName: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  /** Rol real del usuario en la empresa. */
  role: AppRole;
  /** Solo para Administrativo viendo la demo como Operario: con qué operario simular el flujo. */
  actingOperatorId: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;

  loadWorkspace: (ws: Workspace) => void;
  refreshWorkspace: () => Promise<void>;
  confirmOperation: <T>(operation: () => Result<T> | Promise<Result<T>>) => Promise<Result<T>>;
  setMode: (mode: RoleKey) => void;
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
  /** Horas contra una asignación (el Operario, en "Mi día"). */
  logHours: (id: string, input: ops.HoursInput) => Result;
  /**
   * Carga manual del Administrativo: crea la asignación (producto + rubro + operario + día, con esas horas previstas)
   * y carga las horas contra ella. Así toda hora tiene su asignación.
   */
  logHoursManual: (id: string, input: ManualHoursInput) => Result;
  addActualEntry: (id: string, input: ops.ActualInput) => Result;

  assignOperators: (id: string, operatorIds: string[]) => Result;
  addItem: (id: string, input: ProductInput) => Result;
  updateItem: (id: string, itemId: string, input: ProductInput) => Result;
  /** Unidades terminadas de un producto: las carga el Jefe de planta (o un Administrativo). */
  setCompletedUnits: (projectId: string, itemId: string, units: number) => Result;
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
  /** Un cambio de costo por hora vale desde `validFrom` (hoy por defecto): las horas anteriores no cambian. */
  updateOperator: (id: string, input: people.OperatorInput, validFrom?: string) => Result;
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
  updateSettings: (patch: Partial<AlertSettings>) => Result;
  /** Un cambio del multiplicador de horas extra vale desde `validFrom` (hoy por defecto). */
  updateCostSettings: (patch: Partial<CostSettings>, validFrom?: string) => Result;
  /**
   * Guarda las tarifas como un cambio con "vigente desde" (hoy por defecto). Lo ya cotizado y las horas
   * ya cargadas conservan su valor; un cambio con fecha futura recién aplica ese día.
   */
  saveHourRates: (rates: HourRate[], validFrom?: string) => Result;
  /** Precios de catálogo de materiales con "vigente desde". Solo afectan cotizaciones nuevas. */
  setMaterialPrices: (prices: Array<{ materialId: string; value: number; previousValue: number }>, validFrom: string) => Result;
  /** Crea (sin id) o modifica una asignación. La hacen el Jefe de planta y Administrativo. */
  saveAssignment: (input: AssignmentInput & { id?: string }) => Result<string>;
  /** Quita una asignación. */
  removeAssignment: (id: string) => Result;
  /** Días laborales y excepciones de un operario: Jefe de planta o Administrativo. */
  saveSchedule: (operatorId: string, change: ScheduleChange) => Result;
  /** Crea (sin id) o modifica una orden en Borrador. Devuelve el id. Compras o Administrativo. */
  saveOrder: (draft: OrderDraft & { id?: string }) => Result<string>;
  sendOrder: (id: string) => Result;
  /** Facturada: crea las compras reales (desde acá cambia el costo real de materiales del proyecto). */
  invoiceOrder: (id: string, invoice: InvoiceInput) => Result;
  /** Pagada sí/no: información financiera, no cambia costos. */
  setOrderPaid: (id: string, paid: boolean) => Result;
  /** Recibe cantidades: el material entra al proyecto. */
  receiveOrder: (id: string, receipts: ReceiptInput[]) => Result;
  /** Corrige un valor congelado (proyecto aprobado o cerrado) con motivo: queda registrado. */
  correctValue: (projectId: string, input: CorrectionInput) => Promise<Result>;
  /** Reemplaza los datos de la empresa por la demo de Madera Sur. */
  resetDemo: () => Promise<Result>;
  /** Borra todos los datos de la empresa para empezar de cero. */
  clearData: () => Promise<Result>;
  dismissSyncError: () => void;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Ocurrió un error inesperado.";
}

export interface ManualHoursInput {
  requestId?: string;
  operatorId: string;
  itemId: string;
  rubro: RubroId;
  date: string;
  hours: number;
  comment?: string;
  confirmHighHours?: boolean;
}

export function demoData(): WorkspaceData {
  const seed = buildSeed(new Date());
  return {
    projects: seed.projects,
    assignments: seed.assignments,
    orders: seed.orders,
    dayExceptions: seed.dayExceptions,
    operators: seed.operators,
    stock: seed.stock,
    requests: [],
    settings: { ...DEFAULT_SETTINGS },
    resolvedAlertIds: [],
  };
}

const EMPTY_DATA: WorkspaceData = {
  projects: [],
  assignments: [],
  orders: [],
  dayExceptions: [],
  operators: [],
  stock: EMPTY_STOCK,
  requests: [],
  settings: { ...DEFAULT_SETTINGS },
  resolvedAlertIds: [],
};

/**
 * Quién está operando: el rol de la cuenta o, en una empresa demo, el rol elegido por un Administrativo
 * (con su usuario de ejemplo; como Operario, el operario elegido).
 */
export function effectiveIdentity(
  s: Pick<AppState, "role" | "currentMode" | "isDemo" | "operators" | "userId" | "userEmail" | "actingOperatorId" | "userName">,
): {
  role: AppRole;
  roleKey: RoleKey;
  operator: Operator | undefined;
  actor: string;
} {
  if (s.role === "operator") {
    const operator = people.operatorForUser(s.operators, s.userId, s.userEmail);
    return { role: "operator", roleKey: "operario", operator, actor: operator?.name ?? s.userName };
  }
  const real = roleKeyOf(s.role);
  const view = real === "admin" && s.isDemo ? s.currentMode : real;
  if (view === "operario") {
    // En la demo siempre hay un operario elegido: el que se eligió o, si no, el primero activo.
    const operator = s.operators.find((o) => o.id === s.actingOperatorId && o.active) ?? s.operators.find((o) => o.active);
    return { role: "operator", roleKey: "operario", operator, actor: operator?.name ?? s.userName };
  }
  if (view === "compras" || view === "jefe_planta") {
    return { role: view, roleKey: view, operator: undefined, actor: real === "admin" ? DEMO_USERS[view].name : s.userName };
  }
  return { role: s.role, roleKey: "admin", operator: undefined, actor: s.userName };
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
      let revision = 0;
      let confirming = false;
      let refreshInFlight: Promise<void> | null = null;
      const refreshWorkspace = (duringConfirmation = false): Promise<void> => {
        if (refreshInFlight) return duringConfirmation ? refreshInFlight.then(() => refreshWorkspace(true)) : refreshInFlight;
        if (!get().organizationId || pending || (confirming && !duringConfirmation)) return Promise.resolve();
        const start = revision;
        const org = get().organizationId;
        refreshInFlight = remote.loadWorkspace(createClient()).then((ws) => {
          if (start === revision && !pending && (!confirming || duringConfirmation) && org === get().organizationId) get().loadWorkspace(ws);
        }).finally(() => { refreshInFlight = null; });
        return refreshInFlight;
      };
      const persistRemote = (write: (db: ReturnType<typeof createClient>, org: string) => Promise<unknown>) => {
        const org = get().organizationId;
        if (!org) return queue;
        revision += 1;
        pending += 1;
        set({ syncStatus: "saving" });
        queue = queue
          .then(() => {
            if (get().syncStatus === "error") throw new Error("Hay un guardado fallido. Actualizá los datos antes de continuar.");
            return write(createClient(), org);
          })
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
        // Compras escribe solo órdenes de compra (con sus funciones) y el stock es solo consulta; el Jefe de planta, asignaciones.
        if (prev.role === "jefe_planta" || prev.role === "compras") {
          throw new ops.DomainError("Con tu rol no se cargan estos datos en Blerp.");
        }
        set({ projects, stock, operators, requests });
        if (prev.role === "operator") {
          // Taller no escribe tablas: cada registro nuevo va a su función del servidor (que calcula los costos).
          const calls = tallerCalls({ projects: prev.projects, stock: prev.stock, requests: prev.requests }, { projects, stock, requests }, prev.organizationId ?? "");
          void persistRemote((db) => remote.runTallerCalls(db, calls));
          return;
        }
        void persistRemote((db, org) => remote.commitChange(db, org, prev, { projects, stock, operators, requests }));
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
        if (!isManager(effectiveIdentity(get()).role)) throw new ops.DomainError(`${what} lo hace un usuario Administrativo.`);
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

      /** Órdenes de compra: Compras o Administrativo (la base valida lo mismo). */
      const findOrder = (id: string): PurchaseOrder => {
        if (!isBuyer(effectiveIdentity(get()).role)) throw new ops.DomainError("Las órdenes de compra las maneja Compras o un usuario Administrativo.");
        const o = get().orders.find((x) => x.id === id);
        if (!o) throw new ops.DomainError("Orden no encontrada.");
        return o;
      };
      const replaceOrder = (o: PurchaseOrder) => set({ orders: get().orders.map((x) => (x.id === o.id ? o : x)) });

      /** Reemplaza todos los datos de la empresa (reset demo / vaciar). Espera a las escrituras previas. */
      const replaceAll = (data: WorkspaceData, isDemo: boolean): Promise<Result> => {
        const org = get().organizationId;
        if (!org) return Promise.resolve({ ok: false, error: "Todavía no cargó tu empresa." });
        set({ syncStatus: "saving" });
        const run2 = queue.then(async (): Promise<Result> => {
          try {
            await remote.replaceWorkspace(createClient(), org, isDemo ? data : null);
            set({ ...data, dayExceptions: data.dayExceptions ?? [], isDemo, currentMode: "admin", actingOperatorId: null, syncStatus: "idle", syncError: null });
            return { ok: true, value: undefined };
          } catch (e) {
            set({ syncStatus: "error", syncError: `No se pudo guardar: ${errorMessage(e)}` });
            return { ok: false, error: errorMessage(e) };
          }
        });
        queue = run2;
        return run2;
      };

      /** Agrega registros al historial de precios (en memoria y en la base). El historial solo crece. */
      const addHistory = (records: PriceRecord[]) => {
        if (records.length === 0) return;
        set({ priceHistory: [...get().priceHistory, ...records] });
        void persistRemote((db, org) => remote.addPriceRecords(db, org, records));
      };

      /** Registros de un cambio de valor con vigencia. */
      const changeOf = (kind: PriceRecord["kind"], subjectId: string, value: number, previousValue: number, validFrom: string) =>
        priceChange(get().priceHistory, { kind, subjectId, value, validFrom, previousValue, createdBy: effectiveIdentity(get()).actor, now: new Date().toISOString() });

      return {
        ...EMPTY_DATA,
        reviewedHoursKeys: [],
        dayExceptions: [],
        costSettings: { ...DEFAULT_COST_SETTINGS },
        hourRates: DEFAULT_HOUR_RATES.map((r) => ({ ...r })),
        priceHistory: [],
        corrections: [],
        isDemo: false,
        currentMode: "admin",
        organizationId: null,
        organizationName: "",
        userId: null,
        userName: "",
        userEmail: "",
        role: "owner",
        actingOperatorId: null,
        syncStatus: "idle",
        syncError: null,

        refreshWorkspace,
        confirmOperation: async (operation) => {
          if (confirming || pending) return { ok: false, error: "Hay un guardado en curso. Esperá un momento." };
          if (get().syncStatus === "error") return { ok: false, error: "Actualizá los datos antes de volver a guardar." };
          confirming = true;
          revision += 1;
          set({ syncStatus: "saving" });
          try {
            const result = await operation();
            await queue;
            const error = get().syncError;
            if (error) {
              await refreshWorkspace(true).catch(() => undefined);
              return { ok: false, error };
            }
            set({ syncStatus: "idle" });
            // Releer también en éxito: costos, IDs y numeración pertenecen al servidor.
            await refreshWorkspace(true).catch(() => {
              set({ syncStatus: "error", syncError: "Guardado confirmado. No pudimos actualizar las vistas; actualizá antes de seguir." });
            });
            return result;
          } catch (e) {
            set({ syncStatus: "error", syncError: "No se pudo verificar el estado guardado. Actualizá antes de reintentar." });
            return { ok: false, error: errorMessage(e) };
          } finally { confirming = false; }
        },
        loadWorkspace: (ws) => {
          set({
            reviewedHoursKeys: ws.reviewedHoursKeys ?? [],
            projects: ws.projects,
            assignments: ws.assignments,
            orders: ws.orders,
            dayExceptions: ws.dayExceptions ?? [],
            operators: ws.operators,
            stock: ws.stock,
            requests: ws.requests,
            settings: ws.settings,
            costSettings: ws.costSettings,
            hourRates: ws.hourRates,
            priceHistory: ws.priceHistory,
            corrections: ws.corrections,
            isDemo: ws.isDemo,
            resolvedAlertIds: ws.resolvedAlertIds,
            organizationId: ws.organizationId,
            organizationName: ws.organizationName,
            userId: ws.userId,
            userName: ws.userName,
            userEmail: ws.userEmail,
            role: ws.role,
            // El rol elegido para mirar la demo solo vale en una empresa demo.
            currentMode: ws.isDemo ? get().currentMode : roleKeyOf(ws.role),
            syncStatus: "idle",
            syncError: null,
          });
          // Datos del modelo anterior: el ledger derivado se guarda una sola vez.
          if (ws.stockMigrated) void persistRemote((db, org) => remote.syncStock(db, org, EMPTY_STOCK, ws.stock));
        },

        setMode: (mode) => {
          // Como Operario, la demo arranca con el primer operario activo (nunca "elegí un operario").
          const { operators, actingOperatorId } = get();
          const valid = operators.some((o) => o.id === actingOperatorId && o.active);
          set({ currentMode: mode, actingOperatorId: valid ? actingOperatorId : (operators.find((o) => o.active)?.id ?? null) });
        },
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

        logHours: (id, input) =>
          mutate(id, (p) => {
            const assignment = get().assignments.find((a) => a.id === input.assignmentId);
            if (assignment) {
              const check = checkHours(get().projects.flatMap((p) => p.actualEntries), assignment.operatorId, assignment.date, input.hours, todayISO(), get().costSettings.hoursPerDay);
              if (check.level === "block") throw new ops.DomainError(check.message);
            }
            const { priceHistory, costSettings, hourRates } = get();
            const laborRate = hourRates.find((r) => r.id === "labor")?.hourlyRate;
            // La hora se valúa con el costo vigente ESE día (precios con vigencia).
            const costAt = (op: Operator, date: string) => assignment?.hourKind && assignment.hourKind !== "labor"
              ? hourRatesAt(hourRates, priceHistory, date).find(r=>r.id === assignment.hourKind)?.hourlyRate ?? 0
              : laborCostAt({ valuation: costSettings.laborValuation, operator: op, laborRate, history: priceHistory, date });
            return ops.logHours(p, get().operators, get().assignments, { ...input, workdayHours: costSettings.hoursPerDay }, get().settings, ctx(), costAt);
          }),

        logHoursManual: (id, input) => {
          if (!isManager(effectiveIdentity(get()).role)) return { ok: false, error: "La carga manual de horas la hace un usuario Administrativo." };
          const check = checkHours(get().projects.flatMap((p) => p.actualEntries), input.operatorId, input.date, input.hours, todayISO(), get().costSettings.hoursPerDay);
          if (check.level === "block") return { ok: false, error: check.message ?? "Horas inválidas." };
          if (check.level === "warn" && !input.confirmHighHours) return { ok: false, error: `${check.message} Confirmá para guardarlas.` };
          if (get().organizationId) {
            const requestId = input.requestId ?? createId("act");
            const assignmentId = createId("asg");
            void persistRemote(async (db) => {
              const { error } = await db.rpc("admin_log_hours_manual", { p: {
                id: requestId, assignment: { id: assignmentId, project_id: id, item_id: input.itemId, rubro: input.rubro,
                  operator_id: input.operatorId, date: input.date, planned_hours: input.hours },
                hours: input.hours, notes: input.comment,
              } });
              if (error) throw new Error(error.message);
            });
            return { ok: true, value: undefined };
          }
          const saved = get().saveAssignment({ projectId: id, itemId: input.itemId, rubro: input.rubro, operatorId: input.operatorId, date: input.date, plannedHours: input.hours });
          if (!saved.ok) return saved;
          return get().logHours(id, { assignmentId: saved.value, hours: input.hours, comment: input.comment, confirmHighHours: input.confirmHighHours });
        },

        addActualEntry: (id, input) => mutate(id, (p) => ops.addActual(p, input, get().settings, ctx())),

        assignOperators: (id, operatorIds) => mutate(id, (p) => ops.assignOperators(p, operatorIds, get().operators, ctx())),
        addItem: (id, input) => mutate(id, (p) => ops.addItem(p, input, ctx())),
        updateItem: (id, itemId, input) => mutate(id, (p) => ops.updateItem(p, itemId, input, ctx())),
        setCompletedUnits: (projectId, itemId, units) =>
          run(() => {
            const who = effectiveIdentity(get()).roleKey;
            if (who !== "admin" && who !== "jefe_planta") throw new ops.DomainError("Las unidades terminadas las carga el Jefe de planta.");
            const project = find(projectId);
            const item = project.items.find((i) => i.id === itemId);
            if (!item) throw new ops.DomainError("Producto no encontrado.");
            if (!Number.isInteger(units) || units < 0 || units > item.quantity) throw new ops.DomainError(`Las unidades terminadas van de 0 a ${item.quantity}.`);
            const now = new Date().toISOString();
            // Ya se guarda con la función de planta: se actualiza la memoria sin volver a escribir el proyecto.
            set({
              projects: get().projects.map((p) =>
                p.id === projectId ? { ...p, updatedAt: now, items: p.items.map((i) => (i.id === itemId ? { ...i, completedUnits: units } : i)) } : p,
              ),
            });
            void persistRemote((db) => remote.setCompletedUnits(db, projectId, itemId, units));
            return undefined;
          }),
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

        updateOperator: (id, input, validFrom = todayISO()) =>
          run(() => {
            requireManager("Editar operarios");
            const current = get().operators.find((o) => o.id === id);
            if (!current) throw new ops.DomainError("Operario no encontrado.");
            const records = input.hourlyCost > 0 ? changeOf("operator_cost", id, input.hourlyCost, current.hourlyCost, validFrom) : [];
            // El costo que se ve es el vigente hoy (un cambio con fecha futura todavía no aplica).
            const hourlyCost = valueAt([...get().priceHistory, ...records], "operator_cost", id, todayISO(), input.hourlyCost);
            const operators = people.updateOperator(get().operators, id, { ...input, hourlyCost: records.length ? hourlyCost : input.hourlyCost });
            addHistory(records);
            commit({ operators });
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
          return { ok: true, value: undefined };
        },

        updateCostSettings: (patch, validFrom = todayISO()) => {
          if (!isManager(effectiveIdentity(get()).role)) return { ok: false, error: "Configuración la cambia un usuario Administrativo." };
          const prev = get().costSettings;
          const next = { ...prev, ...patch };
          const error = costSettingsError(next) ?? (patch.overtimeMultiplier !== undefined ? priceChangeError({ value: next.overtimeMultiplier, validFrom }) : null);
          if (error) return { ok: false, error };
          const records = patch.overtimeMultiplier !== undefined ? changeOf("overtime_multiplier", OVERTIME_SUBJECT, next.overtimeMultiplier, prev.overtimeMultiplier, validFrom) : [];
          const history = [...get().priceHistory, ...records];
          // Vigente hoy: un cambio con fecha futura todavía no aplica.
          const costSettings = { ...next, overtimeMultiplier: valueAt(history, "overtime_multiplier", OVERTIME_SUBJECT, todayISO(), next.overtimeMultiplier) };
          addHistory(records);
          set({ costSettings });
          void persistRemote((db, org) => remote.saveCostSettings(db, org, costSettings));
          return { ok: true, value: undefined };
        },
        saveHourRates: (rates, validFrom = todayISO()) => {
          if (!isManager(effectiveIdentity(get()).role)) return { ok: false, error: "Las tarifas las cambia un usuario Administrativo." };
          const error = hourRatesError(rates) ?? priceChangeError({ value: 1, validFrom });
          if (error) return { ok: false, error };
          const prev = get().hourRates;
          const records = rates.flatMap((r) => changeOf("hour_rate", r.id, r.hourlyRate, prev.find((p) => p.id === r.id)?.hourlyRate ?? r.hourlyRate, validFrom));
          const hourRates = hourRatesAt(rates, [...get().priceHistory, ...records], todayISO());
          addHistory(records);
          set({ hourRates });
          void persistRemote((db, org) => remote.saveHourRates(db, org, hourRates));
          return { ok: true, value: undefined };
        },
        setMaterialPrices: (prices, validFrom) => {
          if (!isManager(effectiveIdentity(get()).role)) return { ok: false, error: "Los precios los cambia un usuario Administrativo." };
          const bad = prices.map((p) => priceChangeError({ value: p.value, validFrom })).find(Boolean);
          if (bad) return { ok: false, error: bad };
          addHistory(prices.flatMap((p) => changeOf("material_price", p.materialId, p.value, p.previousValue, validFrom)));
          return { ok: true, value: undefined };
        },
        saveAssignment: (input) =>
          run(() => {
            const who = effectiveIdentity(get()).roleKey;
            if (who !== "admin" && who !== "jefe_planta") throw new ops.DomainError("Las asignaciones las hace el Jefe de planta.");
            const { projects, operators, assignments } = get();
            const error = assignmentError(input, { projects, operators });
            if (error) throw new ops.DomainError(error);
            const previous = input.id ? assignments.find((a) => a.id === input.id) : undefined;
            const a: WorkAssignment = {
              id: input.id ?? createId("asg"),
              projectId: input.projectId,
              hourKind: input.hourKind ?? "labor",
              itemId: input.itemId,
              rubro: input.rubro,
              operatorId: input.operatorId,
              date: input.date,
              plannedHours: input.plannedHours,
              createdBy: previous?.createdBy ?? effectiveIdentity(get()).actor,
              createdAt: previous?.createdAt ?? new Date().toISOString(),
            };
            // El operario pasa al equipo del proyecto (la base hace lo mismo): así lo ve en "Mi día".
            set({
              assignments: previous ? assignments.map((x) => (x.id === a.id ? a : x)) : [...assignments, a],
              projects: projects.map((p) =>
                p.id === a.projectId && !p.assignedOperatorIds.includes(a.operatorId) ? { ...p, assignedOperatorIds: [...p.assignedOperatorIds, a.operatorId] } : p,
              ),
            });
            void persistRemote((db) => remote.saveAssignment(db, a));
            return a.id;
          }),
        removeAssignment: (id) =>
          run(() => {
            const who = effectiveIdentity(get()).roleKey;
            if (who !== "admin" && who !== "jefe_planta") throw new ops.DomainError("Las asignaciones las hace el Jefe de planta.");
            set({ assignments: get().assignments.filter((a) => a.id !== id) });
            void persistRemote((db) => remote.removeAssignment(db, id));
            return undefined;
          }),
        saveSchedule: (operatorId, change) =>
          run(() => {
            const who = effectiveIdentity(get()).roleKey;
            if (who !== "admin" && who !== "jefe_planta") throw new ops.DomainError("Los días laborales los define el Jefe de planta.");
            const operator = get().operators.find((o) => o.id === operatorId);
            if (!operator) throw new ops.DomainError("Operario no encontrado.");
            const error = (change.workDays ? workDaysError(change.workDays) : null) ?? (change.add ?? []).map(exceptionError).find(Boolean) ?? null;
            if (error) throw new ops.DomainError(error);
            const now = new Date().toISOString();
            const by = effectiveIdentity(get()).actor;
            const added: DayException[] = (change.add ?? []).map((x) => ({ operatorId, date: x.date, works: x.works, hours: x.works ? x.hours : undefined, note: x.note?.trim() || undefined, createdBy: by, createdAt: now }));
            const touched = new Set([...added.map((x) => x.date), ...(change.remove ?? [])]);
            // Se guarda con la función de planta: se actualiza la memoria sin volver a escribir los operarios.
            set({
              operators: change.workDays
                ? get().operators.map((o) => (o.id === operatorId ? { ...o, workDays: [...new Set(change.workDays)].sort((a, b) => a - b) } : o))
                : get().operators,
              dayExceptions: [...get().dayExceptions.filter((x) => !(x.operatorId === operatorId && touched.has(x.date))), ...added].sort((a, b) => a.date.localeCompare(b.date)),
            });
            void persistRemote((db) => remote.saveSchedule(db, operatorId, change));
            return undefined;
          }),
        saveOrder: (draft) =>
          run(() => {
            if (!isBuyer(effectiveIdentity(get()).role)) throw new ops.DomainError("Las órdenes de compra las maneja Compras o un usuario Administrativo.");
            const error = orderDraftError(draft);
            if (error) throw new ops.DomainError(error);
            const previous = draft.id ? findOrder(draft.id) : undefined;
            if (previous && previous.status !== "draft") throw new ops.DomainError("Solo se modifica una orden en Borrador.");
            const order: PurchaseOrder = {
              id: previous?.id ?? createId("oc"),
              number: previous?.number ?? nextOrderNumber(get().orders),
              supplier: draft.supplier.trim(),
              date: draft.date,
              status: "draft",
              paid: false,
              received: "no",
              notes: draft.notes?.trim() || undefined,
              lines: draft.lines.map((l) => ({
                ...l,
                id: previous?.lines.find((x) => x.projectId === l.projectId && x.budgetLineId === l.budgetLineId)?.id ?? createId("ocl"),
                receivedQuantity: 0,
              })),
              createdBy: previous?.createdBy ?? effectiveIdentity(get()).actor,
              createdAt: previous?.createdAt ?? new Date().toISOString(),
            };
            set({ orders: previous ? get().orders.map((x) => (x.id === order.id ? order : x)) : [...get().orders, order] });
            void persistRemote((db) => remote.saveOrder(db, order));
            return order.id;
          }),
        sendOrder: (id) =>
          run(() => {
            const o = findOrder(id);
            if (o.status !== "draft") throw new ops.DomainError("Solo se envía una orden en Borrador.");
            replaceOrder({ ...o, status: "sent" });
            void persistRemote((db) => remote.orderStatus(db, { id, action: "send" }));
            return undefined;
          }),
        invoiceOrder: (id, invoice) =>
          run(() => {
            const o = findOrder(id);
            const error = invoiceError(o, invoice);
            if (error) throw new ops.DomainError(error);
            const { actor } = effectiveIdentity(get());
            const now = new Date().toISOString();
            const entries = invoiceEntries(o, invoice, actor, now);
            // La base crea lo mismo (mismos ids): se actualiza la memoria sin volver a escribir los proyectos.
            set({
              projects: get().projects.map((p) => {
                const mine = entries.filter((e) => e.projectId === p.id);
                if (mine.length === 0) return p;
                const events = invoiceActivity(o, p.id, invoice.invoiceNumber, actor, now, () => createId("act"));
                return { ...p, updatedAt: now, purchaseEntries: [...p.purchaseEntries, ...mine], activity: [...events, ...p.activity] };
              }),
            });
            replaceOrder({ ...o, status: "invoiced", invoiceNumber: invoice.invoiceNumber.trim(), invoiceAmount: invoice.invoiceAmount, invoiceDate: invoice.invoiceDate });
            void persistRemote((db) =>
              remote.orderStatus(db, { id, action: "invoice", invoice_number: invoice.invoiceNumber.trim(), invoice_amount: invoice.invoiceAmount, invoice_date: invoice.invoiceDate }),
            );
            return undefined;
          }),
        setOrderPaid: (id, paid) =>
          run(() => {
            const o = findOrder(id);
            if (o.status !== "invoiced") throw new ops.DomainError("Solo se marca como pagada una orden Facturada.");
            replaceOrder({ ...o, paid });
            void persistRemote((db) => remote.orderStatus(db, { id, action: "paid", paid }));
            return undefined;
          }),
        receiveOrder: (id, receipts) =>
          run(() => {
            const o = findOrder(id);
            const { actor } = effectiveIdentity(get());
            const res = receiveOrderLines(o, receipts, get().projects, { actor, now: new Date().toISOString(), today: todayISO() });
            if (res.sent.length === 0) throw new ops.DomainError("Indicá cuánto llegó de cada material.");
            // La base crea el mismo lote y movimiento: se actualiza la memoria sin volver a escribir el stock.
            set({ stock: applyChange(get().stock, res.change) });
            replaceOrder(res.order);
            void persistRemote((db) => remote.orderStatus(db, { id, action: "receive", receipts: res.sent }));
            return undefined;
          }),
        correctValue: async (projectId, input) => {
          const project = get().projects.find((p) => p.id === projectId);
          if (!project) return { ok: false, error: "Proyecto no encontrado." };
          if (!isManager(effectiveIdentity(get()).role)) return { ok: false, error: "Las correcciones las hace un usuario Administrativo." };
          const error = correctionError(project, input);
          if (error) return { ok: false, error };
          try {
            // Primero se terminan de guardar los cambios pendientes; la corrección la registra el servidor.
            await queue;
            const receipt = await remote.correctValue(createClient(), projectId, input);
            const current = get().projects.find((p) => p.id === projectId) ?? project;
            const res = applyCorrection(current, input, receipt);
            // Ya está guardado en la base: se actualiza la memoria sin volver a escribir.
            set({ projects: get().projects.map((p) => (p.id === projectId ? res.project : p)), corrections: [...get().corrections, res.correction] });
            return { ok: true, value: undefined };
          } catch (e) {
            return { ok: false, error: errorMessage(e) };
          }
        },

        resetDemo: () => replaceAll(demoData(), true),
        clearData: () => replaceAll({ ...EMPTY_DATA, settings: { ...DEFAULT_SETTINGS } }, false),
        dismissSyncError: () => { void refreshWorkspace().catch(() => undefined); },
      };
    },
    {
      name: "nexo-ui-v2",
      version: 4,
      storage: createJSONStorage(() => localStorage),
      // v3 guardaba "management" / "workshop" (Gestión / Taller).
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as { currentMode?: string; actingOperatorId?: string | null };
        const mode = version < 4 ? (s.currentMode === "workshop" ? "operario" : "admin") : s.currentMode;
        return { currentMode: mode as RoleKey, actingOperatorId: s.actingOperatorId ?? null } as Partial<AppState>;
      },
      skipHydration: true,
      partialize: (s) => ({ currentMode: s.currentMode, actingOperatorId: s.actingOperatorId }),
    },
  ),
);

export function useProject(id: string): Project | undefined {
  return useAppStore((s) => s.projects.find((p) => p.id === id));
}
