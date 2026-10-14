// Cotización en curso: se arma en el Cotizador y se lleva al asistente de "Nuevo proyecto".
// Vive solo en memoria (navegación interna); si se recarga la página, se arma de nuevo.
import type { CalcState } from "./calculator-state";

export interface QuoteDraft {
  state: CalcState;
  /** "" = no se eligió tipo en el Cotizador (se elige en "Datos del proyecto"). */
  projectType: string;
  salesPrice: number;
}

let draft: QuoteDraft | null = null;

export const setQuoteDraft = (d: QuoteDraft) => {
  draft = d;
};
export const peekQuoteDraft = () => draft;
export const clearQuoteDraft = () => {
  draft = null;
};
