// ─────────────────────────────────────────────────────────────
// Blerp — Modelo de dominio
// Estas entidades son independientes de la UI y de la persistencia.
// Hoy se guardan en localStorage (Zustand persist); el mismo modelo
// puede servirse luego desde una API/base de datos.
// ─────────────────────────────────────────────────────────────

export type ProjectStatus =
  | "quotation"
  | "approved"
  | "purchasing"
  | "production"
  | "installation"
  | "completed";

/**
 * Categorías de reporte (Lote 4). Se derivan de los rubros de la cotización y son las mismas en todas las pantallas.
 * Las siete anteriores se normalizan al leer (ver normalizeCategory).
 */
export type BudgetCategory = "materials" | "labor" | "design" | "admin" | "transport" | "financial" | "contingency";

/** Rubros (sectores) del catálogo cerrado de la cotización. */
export type RubroId =
  | "carpinteria_madera"
  | "carpinteria_metalica"
  | "plasticos"
  | "vidrios"
  | "instalacion_electrica"
  | "pintura"
  | "herrajes"
  | "graficas"
  | "insumos"
  | "transporte"
  | "embalaje"
  | "montaje"
  | "imprevistos";

/**
 * Tipo de un costo real (no material). Los valores coinciden con la base de datos.
 * "finishing" y el uso de máquinas ("other" con categoría Máquinas) solo existen en registros viejos.
 */
export type ActualEntryType =
  | "labor"
  | "outsourcing"
  | "finishing"
  | "logistics"
  | "installation"
  | "unexpected"
  | "other";

export type MaterialSource = "purchased_for_project" | "existing_stock" | "reused_leftover";

/** Cómo se determinó el costo unitario de un consumo (trazabilidad, evita caja negra). */
export type UnitCostOrigin = "manual" | "purchase" | "budget" | "catalog" | "reusable_pool";

export type AppMode = "management" | "workshop";

export type AlertLevel = "info" | "warning" | "critical";

/**
 * Salud de un proyecto en curso (los finalizados no llevan chip):
 * risk = al menos una alerta Crítica abierta · attention = alertas de Atención y ninguna Crítica
 * · healthy = hay datos y no hay alertas · no_data = todavía no hay consumos ni costos.
 */
export type EconomicHealth = "no_data" | "healthy" | "attention" | "risk";

export interface BudgetLine {
  id: string;
  category: BudgetCategory;
  description: string;
  /** Solo para líneas de materiales: vincula con el catálogo para reconciliar. */
  materialId?: string;
  /** null = monto directo (no aplica cantidad). */
  quantity: number | null;
  unit: string;
  /** Si quantity es null, unitCost representa el monto directo. */
  unitCost: number;
  total: number;
  notes?: string;
  /** Rubro de la cotización. Vacío solo en líneas anteriores al Lote 4 sin rubro reconocible. */
  rubro?: RubroId;
  /** Horas: tipo de hora cuya tarifa se usó. La tarifa queda congelada en unitCost. */
  hourRateId?: string;
  /** Operario asignado. El Cotizador ya no lo usa (Lote 4); queda para que el jefe de planta asigne (Lote 5). */
  operatorId?: string;
  /** "overtime" = horas extra: unitCost ya es tarifa × multiplicador. */
  hourType?: "normal" | "overtime";
  /** Mano de obra: jornada (horas por día) usada al cotizar, congelada con la tarifa. */
  hoursPerDay?: number;
  /** Multiplicador usado en las horas extra (trazabilidad del importe). */
  overtimeMultiplier?: number;
}

/** Costos de la empresa que solo ve Gestión (Taller nunca los recibe). */
export interface CostSettings {
  /** Horas extra = tarifa por hora × este multiplicador. */
  overtimeMultiplier: number;
  /** Gasto financiero: % sobre el precio de venta (a confirmar con el cliente). */
  financialPct: number;
  /** Jornada del operario, en horas por día (Configuración). */
  hoursPerDay: number;
}

/** Categorías de reporte que pueden tener horas. */
export type HourCategory = Extract<BudgetCategory, "labor" | "design" | "admin">;

/**
 * Tipo de hora con su tarifa (Configuración). Es una lista: se pueden sumar tipos sin cambiar el modelo.
 * `category` dice en qué categoría de reporte caen sus horas.
 */
export interface HourRate {
  id: string;
  name: string;
  hourlyRate: number;
  category: HourCategory;
}

export interface PurchaseEntry {
  id: string;
  projectId: string;
  materialId?: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  total: number;
  supplier?: string;
  date: string; // ISO yyyy-mm-dd
  notes?: string;
  createdBy: string;
  createdAt: string; // ISO datetime
}

export interface MaterialUsageEntry {
  id: string;
  projectId: string;
  materialId: string;
  materialName: string;
  date: string;
  quantityConsumed: number;
  wasteQuantity: number;
  reusableLeftoverQuantity: number;
  unit: string;
  unitCost: number;
  unitCostOrigin: UnitCostOrigin;
  source: MaterialSource;
  /** Si source = reused_leftover, qué ítem del pool se usó. */
  reusableMaterialId?: string;
  /** Lote de stock del que salió el material (ledger). */
  lotId?: string;
  /** Mueble del proyecto al que se imputa (vacío = general del proyecto). */
  itemId?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface LaborDetail {
  role: string;
  workerName?: string;
  hours: number;
  /** Se congela al registrar: cambiar la tarifa del operario no altera el historial. */
  hourlyCost: number;
}

export interface ActualEntry {
  id: string;
  projectId: string;
  date: string;
  type: ActualEntryType;
  category: BudgetCategory;
  description: string;
  amount: number;
  supplier?: string;
  labor?: LaborDetail;
  /** Operario (tabla de operarios) que hizo las horas. */
  operatorId?: string;
  /** Etapa en la que se trabajó. */
  stage?: ProjectStatus;
  /** Mueble del proyecto al que se imputa (vacío = general del proyecto). */
  itemId?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export type ActivityKind =
  | "created"
  | "status"
  | "budget"
  | "purchase"
  | "usage"
  | "cost"
  | "leftover"
  | "deviation"
  | "progress"
  | "stock"
  | "stage"
  | "closed";

export interface ActivityEvent {
  id: string;
  at: string;
  actor: string;
  kind: ActivityKind;
  message: string;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  client: string;
  projectType: string;
  description: string;
  status: ProjectStatus;
  startDate: string;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  salesPrice: number;
  owner: string;
  budgetLines: BudgetLine[];
  actualEntries: ActualEntry[];
  materialUsages: MaterialUsageEntry[];
  purchaseEntries: PurchaseEntry[];
  activity: ActivityEvent[];
  isClosed: boolean;
  closedAt?: string;
  /** Operarios asignados al proyecto (ids de la tabla de operarios). */
  assignedOperatorIds: string[];
  /** Muebles / ítems del proyecto. Vacío = proyecto de un solo bloque. */
  items: ProjectItem[];
  /** Bitácora por etapa (compras, producción, instalación). */
  stageLogs: StageLog[];
  /** Archivos adjuntos (proyecto, mueble o etapa). */
  attachments: Attachment[];
  /** Presupuesto aprobado original. Se captura una sola vez y no se pisa. */
  baseline?: ProjectBaseline;
}

export interface ProjectItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
}

export interface ProjectBaseline {
  capturedAt: string;
  capturedBy: string;
  salesPrice: number;
  dueDate: string;
  budgetTotal: number;
  lines: BudgetLine[];
}

export type StageKey = "purchasing" | "production" | "installation";

export interface StageLog {
  id: string;
  projectId: string;
  stage: StageKey;
  date: string;
  kind: "note" | "incident";
  text: string;
  responsible?: string;
  itemId?: string;
  createdBy: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  projectId: string;
  itemId?: string;
  stage?: StageKey;
  stageLogId?: string;
  name: string;
  mimeType: string;
  size: number;
  /** Ruta dentro del bucket de Supabase Storage. */
  storagePath: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Operator {
  id: string;
  name: string;
  role: string;
  hourlyCost: number;
  /** false = dado de baja (baja lógica). Sus horas y costos se conservan. */
  active: boolean;
  /** Fecha de la baja. Vacío si está activo. */
  deactivatedAt?: string;
  /** Usuario (auth) vinculado, si el operario entra al sistema. */
  userId?: string;
  email?: string;
  createdAt: string;
}

export interface MaterialRequest {
  id: string;
  projectId: string;
  materialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  note?: string;
  requestedBy: string;
  status: "open" | "resolved" | "cancelled";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

// ── Stock (ledger) ────────────────────────────────────────────

/** Dónde está físicamente (o contablemente) una cantidad de material. */
export type Place =
  | { type: "supplier" }
  | { type: "warehouse" }
  | { type: "project"; projectId: string }
  | { type: "consumed"; projectId: string }
  | { type: "waste"; projectId: string }
  | { type: "converted" };

export type MovementKind =
  | "purchase_in"
  | "opening"
  | "assign"
  | "release"
  | "transfer"
  | "consume"
  | "waste"
  | "to_leftover"
  | "leftover_in"
  | "supplier_return"
  | "adjustment";

/** Medidas opcionales de un sobrante (solo se piden según el tipo de material). */
export interface LeftoverDims {
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  finish?: string;
}

export interface StockLot {
  id: string;
  materialId: string;
  materialName: string;
  unit: string;
  /** Costo unitario del lote: viaja con el material aunque se use en otro proyecto. */
  unitCost: number;
  kind: "purchase" | "leftover" | "opening";
  supplier?: string;
  purchaseEntryId?: string;
  /** Proyecto para el que se compró / del que sobró. */
  originProjectId?: string;
  originProjectName?: string;
  parentLotId?: string;
  location?: string;
  dims?: LeftoverDims;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  lotId: string;
  kind: MovementKind;
  quantity: number;
  from: Place;
  to: Place;
  date: string;
  /** Proyecto al que se imputa (consumo / desperdicio). */
  projectId?: string;
  itemId?: string;
  /** En to_leftover: lote hijo que recibe la cantidad. */
  intoLotId?: string;
  /** Agrupa los movimientos de una misma acción (ej.: las dos patas de un sobrante). */
  groupId?: string;
  note?: string;
  createdBy: string;
  createdAt: string;
}

export interface ReusableMaterial {
  id: string;
  materialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  originProjectId: string;
  originProjectName: string;
  createdAt: string;
}

export interface CatalogMaterial {
  id: string;
  name: string;
  unit: string;
  /** Costo de referencia (último conocido). Solo se usa si no hay compra ni presupuesto. */
  referenceCost: number;
  /** Rubro al que pertenece normalmente. */
  rubro: RubroId;
}

export interface AlertSettings {
  categoryWarningPct: number;
  categoryCriticalPct: number;
  marginWarningPp: number;
  marginCriticalPp: number;
  daysWithoutRecords: number;
  dueSoonDays: number;
  /** Alerta si pasó este % del plazo y el proyecto todavía no llegó a Producción. */
  deadlineNoProductionPct: number;
}

export type AlertKind = "category" | "margin" | "stale" | "due" | "reconciliation" | "staffing";

export interface Alert {
  /** Determinístico: permite marcarla como resuelta. Incluye el nivel para que un agravamiento reaparezca. */
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  message: string;
  impactAmount?: number;
  expectedMargin?: number;
  projectedMargin?: number;
  /**
   * Clave con la que se marca como resuelta: alerta + día + última modificación del proyecto.
   * Si el problema persiste (al día siguiente o después de un nuevo registro), la alerta reaparece.
   */
  resolutionKey: string;
}

export interface DemoUser {
  name: string;
  role: string;
}

/** Rol del usuario dentro de la empresa. owner/member = Gestión; operator = Taller. */
export type AppRole = "owner" | "member" | "operator";
