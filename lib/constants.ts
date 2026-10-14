import type {
  ActualEntryType,
  AlertLevel,
  AlertSettings,
  BudgetCategory,
  CatalogMaterial,
  EconomicHealth,
  HourCategory,
  HourRate,
  MaterialSource,
  ProjectStatus,
  UnitCostOrigin,
} from "@/types";

export const APP_NAME = "Blerp";
export const APP_SUBTITLE = "Rentabilidad por proyecto";
export const COMPANY_NAME = "Madera Sur S.R.L.";

export const LOCALE = "es-AR";
export const CURRENCY = "ARS";

export const STATUS_ORDER: ProjectStatus[] = [
  "quotation",
  "approved",
  "purchasing",
  "production",
  "installation",
  "completed",
];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  quotation: "Cotización",
  approved: "Aprobado",
  purchasing: "Compras",
  production: "Producción",
  installation: "Instalación",
  completed: "Finalizado",
};

/** Estados en los que el proyecto está vendido y en ejecución. */
/** Horas extra = costo por hora × multiplicador. Se cambia en Configuración (p. ej. 1,5 en días hábiles). */
export const DEFAULT_OVERTIME_MULTIPLIER = 2;

/** Jornada del operario por defecto (horas por día). Se cambia en Configuración (entre 1 y 24). */
export const DEFAULT_HOURS_PER_DAY = 9.5;

/** Gasto financiero por defecto: % sobre el precio de venta. A confirmar con el cliente. */
export const DEFAULT_FINANCIAL_PCT = 5;

/** Categorías que tienen horas, en el orden en que se muestran. */
export const HOUR_CATEGORIES: HourCategory[] = ["labor", "design", "admin"];

/** Tipos de hora y tarifas iniciales (las que usa el cliente piloto; se cambian en Configuración). */
export const DEFAULT_HOUR_RATES: HourRate[] = [
  { id: "labor", name: "Mano de obra", hourlyRate: 19_000, category: "labor" },
  { id: "design", name: "Diseño", hourlyRate: 27_000, category: "design" },
  { id: "admin", name: "Administración", hourlyRate: 27_000, category: "admin" },
];

export const ACTIVE_STATUSES: ProjectStatus[] = ["approved", "purchasing", "production", "installation"];

/** El presupuesto base solo se edita antes de ejecutar. Luego es la línea base contra la que se mide. */
export const BUDGET_EDITABLE_STATUSES: ProjectStatus[] = ["quotation", "approved"];

/** Categorías de reporte, siempre en este orden y con estos nombres. Se derivan de los rubros (lib/rubros.ts). */
export const CATEGORY_ORDER: BudgetCategory[] = ["materials", "labor", "design", "admin", "transport", "financial", "contingency"];

export const CATEGORY_LABELS: Record<BudgetCategory, string> = {
  materials: "Materiales",
  labor: "Mano de obra",
  design: "Diseño",
  admin: "Administración",
  transport: "Transporte y fletes",
  financial: "Gasto financiero",
  contingency: "Imprevistos",
};

/** Concordancia gramatical: "Materiales superaron" vs. "Mano de obra superó". */
export const CATEGORY_IS_PLURAL: Record<BudgetCategory, boolean> = {
  materials: true,
  labor: false,
  design: false,
  admin: false,
  transport: false,
  financial: false,
  contingency: true,
};

/**
 * Mapeo de las siete categorías anteriores (Lote 4). La migración 20261013120000 ya convirtió la base;
 * esto cubre lo que todavía escriba una versión vieja de la app sobre la misma base.
 *   Máquinas → Mano de obra (el uso de máquina está incluido en la mano de obra)
 *   Tercerizaciones / Terminaciones → Materiales (se compra hecho)
 *   Logística → Transporte y fletes · Instalación → Mano de obra (rubro Montaje)
 *   "other" → Mano de obra si era uso de máquina; si no, Imprevistos
 */
export function normalizeCategory(raw: string, description = ""): BudgetCategory {
  if ((CATEGORY_ORDER as string[]).includes(raw)) return raw as BudgetCategory;
  switch (raw) {
    case "machines":
    case "installation":
      return "labor";
    case "outsourcing":
    case "finishing":
      return "materials";
    case "logistics":
      return "transport";
    case "other":
      return /^m[aá]quina/i.test(description.trim()) ? "labor" : "contingency";
    default:
      return "contingency";
  }
}

/** Tipos de costo real. "finishing" queda solo para registros viejos. */
export const ACTUAL_TYPE_LABELS: Record<ActualEntryType, string> = {
  labor: "Horas trabajadas",
  outsourcing: "Trabajo comprado hecho",
  finishing: "Tercerización (terminaciones)",
  logistics: "Transporte y fletes",
  installation: "Montaje e instalación",
  unexpected: "Imprevisto",
  other: "Diseño, administración o gasto financiero",
};

/** Categoría por defecto de cada tipo. "other" se registra con su categoría: Diseño, Administración o Gasto financiero. */
export const ACTUAL_TYPE_TO_CATEGORY: Record<ActualEntryType, BudgetCategory> = {
  labor: "labor",
  outsourcing: "materials",
  finishing: "materials",
  logistics: "transport",
  installation: "labor",
  unexpected: "contingency",
  other: "admin",
};

/** Costos reales de tipo "other" que se registran hoy: cada uno con su categoría. */
export const OTHER_COST_CATEGORIES = ["design", "admin", "financial"] as const;
export type OtherCostCategory = (typeof OTHER_COST_CATEGORIES)[number];

export function isOtherCostCategory(c: BudgetCategory): c is OtherCostCategory {
  return (OTHER_COST_CATEGORIES as readonly BudgetCategory[]).includes(c);
}

/** Etiqueta de un costo real ya registrado: los "other" viejos eran uso de máquinas. */
export function actualEntryLabel(e: { type: ActualEntryType; category: BudgetCategory }): string {
  if (e.type === "other") return isOtherCostCategory(e.category) ? CATEGORY_LABELS[e.category] : "Uso de máquinas (registro anterior)";
  return ACTUAL_TYPE_LABELS[e.type];
}

export const SOURCE_LABELS: Record<MaterialSource, string> = {
  purchased_for_project: "Comprado para el proyecto",
  existing_stock: "Stock existente",
  reused_leftover: "Sobrante reutilizado",
};

export const UNIT_COST_ORIGIN_LABELS: Record<UnitCostOrigin, string> = {
  manual: "Ingresado manualmente",
  purchase: "Última compra del proyecto",
  budget: "Costo presupuestado",
  catalog: "Costo de referencia del catálogo",
  reusable_pool: "Valor del sobrante en el pool",
};

export const MATERIAL_CATALOG: CatalogMaterial[] = [
  { id: "mel-blanca-18", name: "Melamina blanca 18 mm", unit: "placa", referenceCost: 50000, rubro: "carpinteria_madera" },
  { id: "mel-grafito-18", name: "Melamina grafito 18 mm", unit: "placa", referenceCost: 62500, rubro: "carpinteria_madera" },
  { id: "mdf-18", name: "MDF 18 mm", unit: "placa", referenceCost: 80000, rubro: "carpinteria_madera" },
  { id: "perfil-alu", name: "Perfil aluminio", unit: "m", referenceCost: 15000, rubro: "carpinteria_metalica" },
  { id: "bisagra", name: "Herraje bisagra", unit: "u", referenceCost: 2500, rubro: "herrajes" },
  { id: "corredera", name: "Corredera", unit: "par", referenceCost: 12500, rubro: "herrajes" },
  { id: "tapacanto", name: "Tapacanto", unit: "m", referenceCost: 1000, rubro: "carpinteria_madera" },
  { id: "fenolico", name: "Fenólico", unit: "placa", referenceCost: 70000, rubro: "carpinteria_madera" },
];

export const OTHER_MATERIAL_ID = "__other__";

/**
 * D4: mínimo de proyectos comparables para estimar con el modelo de predicción.
 * El modelo todavía no existe; con menos proyectos solo se muestran promedios simples.
 */
export const MIN_COMPARABLE_PROJECTS = 10;

export const DEFAULT_SETTINGS: AlertSettings = {
  categoryWarningPct: 10,
  categoryCriticalPct: 20,
  marginWarningPp: 5,
  marginCriticalPp: 10,
  daysWithoutRecords: 7,
  dueSoonDays: 5,
  deadlineNoProductionPct: 50,
};

export const DEMO_USERS = {
  management: { name: "Laura Gómez", role: "Gerencia" },
  workshop: { name: "María Ruiz", role: "Jefa de planta" },
} as const;

export const PROJECT_TYPES = [
  "Local comercial",
  "Oficinas corporativas",
  "Exhibidores",
  "Stand",
  "Mobiliario residencial",
  "Recepción",
  "Otro",
];

// ── Semántica visual centralizada ──────────────────────────────
export const HEALTH_LABELS: Record<EconomicHealth, string> = {
  no_data: "Sin datos todavía",
  healthy: "Sin desvíos",
  attention: "Atención",
  risk: "En riesgo",
};

export const ALERT_LEVEL_LABELS: Record<AlertLevel, string> = {
  info: "Info",
  warning: "Atención",
  critical: "Crítica",
};

export type Tone = "green" | "yellow" | "red" | "blue" | "gray";

export const HEALTH_TONE: Record<EconomicHealth, Tone> = {
  no_data: "gray",
  healthy: "green",
  attention: "yellow",
  risk: "red",
};

export const ALERT_TONE: Record<AlertLevel, Tone> = {
  info: "blue",
  warning: "yellow",
  critical: "red",
};

export const TONE_CLASSES: Record<Tone, { badge: string; text: string; bg: string; border: string; bar: string }> = {
  green: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    bar: "#059669",
  },
  yellow: {
    badge: "bg-amber-50 text-amber-800 ring-amber-600/20",
    text: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    bar: "#d97706",
  },
  red: {
    badge: "bg-red-50 text-red-700 ring-red-600/20",
    text: "text-red-700",
    bg: "bg-red-50",
    border: "border-red-200",
    bar: "#dc2626",
  },
  blue: {
    badge: "bg-blue-50 text-blue-700 ring-blue-600/20",
    text: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    bar: "#2563eb",
  },
  gray: {
    badge: "bg-slate-100 text-slate-700 ring-slate-500/20",
    text: "text-slate-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    bar: "#94a3b8",
  },
};

export const MARGIN_TOOLTIP =
  "Rentabilidad proyectada: costo real hasta hoy + lo que falta del costo presupuestado. Es un cálculo por reglas, no una predicción.";
