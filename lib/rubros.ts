// ─────────────────────────────────────────────────────────────
// Rubros (sectores) de la cotización — catálogo cerrado (Lote 4).
// Cada rubro de tipo "full" tiene materiales, horas de mano de obra y horas
// de diseño y de administración; los de tipo "amount" son solo un importe.
// Las categorías de reporte se derivan de acá (ver lib/budget-calculator.ts).
// ─────────────────────────────────────────────────────────────
import type { BudgetCategory, RubroId } from "@/types";

export interface RubroDef {
  id: RubroId;
  label: string;
  kind: "full" | "amount";
  /** Solo rubros "amount": categoría de reporte del importe. */
  amountCategory?: Extract<BudgetCategory, "transport" | "contingency">;
}

export const RUBROS: readonly RubroDef[] = [
  { id: "carpinteria_madera", label: "Carpintería madera", kind: "full" },
  { id: "carpinteria_metalica", label: "Carpintería metálica", kind: "full" },
  { id: "plasticos", label: "Plásticos", kind: "full" },
  { id: "vidrios", label: "Vidrios", kind: "full" },
  { id: "instalacion_electrica", label: "Instalación eléctrica", kind: "full" },
  { id: "pintura", label: "Pintura / Laqueados", kind: "full" },
  { id: "herrajes", label: "Herrajes", kind: "full" },
  { id: "graficas", label: "Gráficas", kind: "full" },
  { id: "insumos", label: "Insumos", kind: "full" },
  { id: "transporte", label: "Transporte / Fletes", kind: "amount", amountCategory: "transport" },
  { id: "embalaje", label: "Embalaje", kind: "full" },
  { id: "montaje", label: "Montaje", kind: "full" },
  { id: "imprevistos", label: "Imprevistos", kind: "amount", amountCategory: "contingency" },
];

const BY_ID = new Map(RUBROS.map((r) => [r.id, r]));

export function rubroDef(id: RubroId): RubroDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Rubro desconocido: ${id}`);
  return def;
}

export function isRubroId(value: unknown): value is RubroId {
  return typeof value === "string" && BY_ID.has(value as RubroId);
}

export const rubroLabel = (id: RubroId | undefined): string => (id ? rubroDef(id).label : "Sin rubro");
