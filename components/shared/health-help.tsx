"use client";
// Cómo se clasifica cada proyecto (regla fija, no es configuración): ⓘ al lado de la columna "Salud".
import { HEALTH_LABELS } from "@/lib/constants";
import { HelpTip } from "@/components/ui/help-tip";

export function HealthHelp() {
  return (
    <HelpTip label="Cómo se clasifica cada proyecto">
      <span className="block">Usa las alertas abiertas del proyecto (costos, rentabilidad, plazos y material sin destino). Los finalizados no llevan esta etiqueta.</span>
      <span className="block"><strong>{HEALTH_LABELS.risk}:</strong> al menos una alerta crítica abierta.</span>
      <span className="block"><strong>{HEALTH_LABELS.attention}:</strong> alertas de atención abiertas y ninguna crítica.</span>
      <span className="block"><strong>{HEALTH_LABELS.healthy}:</strong> hay datos registrados y no hay alertas abiertas.</span>
      <span className="block"><strong>{HEALTH_LABELS.no_data}:</strong> todavía no se cargó ningún consumo ni costo.</span>
      <span className="block">Cuándo una alerta es de atención o crítica se define en Configuración → Alertas.</span>
    </HelpTip>
  );
}
