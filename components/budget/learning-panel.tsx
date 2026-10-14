"use client";
// "Aprendizaje de proyectos anteriores": desvío promedio por categoría en proyectos finalizados del mismo tipo.
// Es lo único que usa el tipo de proyecto: en el Cotizador se elige acá; en Nuevo proyecto viene del paso 1.
import { Check } from "lucide-react";
import type { BudgetCategory } from "@/types";
import { CATEGORY_LABELS, MIN_COMPARABLE_PROJECTS, PROJECT_TYPES } from "@/lib/constants";
import { formatPercent } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Section } from "./fields";
import type { ProjectTypeControl } from "./budget-calculator";
import type { CalculatorResult } from "./calculator-state";

export function LearningPanel({
  result,
  projectType,
  applied,
  onToggle,
}: {
  result: CalculatorResult;
  projectType: ProjectTypeControl;
  applied: BudgetCategory[];
  onToggle: (c: BudgetCategory) => void;
}) {
  const isDemo = useAppStore((s) => s.isDemo);
  const { benchmarks, suggestions } = result;
  const { onChange } = projectType;

  return (
    <Section
      title="Aprendizaje de proyectos anteriores"
      help="Compara lo presupuestado con lo que realmente costó, por categoría, en proyectos finalizados del mismo tipo. Es un promedio simple, no una predicción. Sumar el margen de seguridad agrega una línea de ajuste en esa categoría."
    >
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {onChange ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="learn-type" className="text-xs font-medium text-slate-600">Tipo de proyecto (opcional)</label>
            <Select id="learn-type" value={projectType.value} onChange={(e) => onChange(e.target.value)}>
              <option value="">Elegí un tipo…</option>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Tipo de proyecto: <strong>{projectType.value}</strong></p>
        )}
        {isDemo && benchmarks.sampleSize > 0 && <Badge>Datos de demostración</Badge>}
      </div>

      {!projectType.value ? (
        <p className="text-sm text-slate-600">Elegí un tipo de proyecto para compararlo con tus proyectos finalizados.</p>
      ) : benchmarks.sampleSize === 0 ? (
        <p className="text-sm text-slate-600">Todavía no hay proyectos finalizados de este tipo.</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-slate-600">
          En {benchmarks.sampleSize} {benchmarks.sampleSize === 1 ? "proyecto finalizado" : "proyectos finalizados"} de este tipo no hubo sobrecostos relevantes por categoría.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Categoría</TH>
                <TH className="text-right">Desvío promedio</TH>
                <TH className="text-right">Proyectos</TH>
                <TH><span className="sr-only">Acción</span></TH>
              </TR>
            </THead>
            <TBody>
              {suggestions.map((s) => {
                const on = applied.includes(s.category);
                return (
                  <TR key={s.category}>
                    <TD className="font-medium text-slate-900">{CATEGORY_LABELS[s.category]}</TD>
                    <TD className="text-right tabular">+{formatPercent(s.avgOverrunPct)}</TD>
                    <TD className="text-right tabular">{s.sampleSize}</TD>
                    <TD className="text-right">
                      <Button size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={() => onToggle(s.category)}>
                        {on && <Check aria-hidden />} Sumar margen de seguridad
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
      {benchmarks.sampleSize > 0 && benchmarks.sampleSize < MIN_COMPARABLE_PROJECTS && (
        <p className="mt-2 text-xs text-slate-500">
          Con menos de {MIN_COMPARABLE_PROJECTS} proyectos comparables, tomalo como un indicio, no como una conclusión.
        </p>
      )}
    </Section>
  );
}
