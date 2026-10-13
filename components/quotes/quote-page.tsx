"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { PROJECT_TYPES } from "@/lib/constants";
import { formatCurrency, formatCurrencyOrDash, formatDate, formatPercent, formatWorkingDays, todayISO, toISODate } from "@/lib/formatting";
import { marginPercent, profitOrNull } from "@/lib/calculations";
import { addWorkingDays } from "@/lib/budget-calculator";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BudgetCalculator } from "@/components/budget/budget-calculator";
import { computeCalculator, initialCalcState, type CalcState } from "@/components/budget/calculator-state";
import { setQuoteDraft } from "@/components/budget/quote-draft";
import { cn } from "@/lib/utils";

function in30days() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return toISODate(d);
}

/** Cotizador: calcula costo, precio sugerido y rentabilidad ANTES de existir un proyecto. */
export function QuotePage() {
  const router = useRouter();
  const projects = useAppStore((s) => s.projects);
  const { overtimeMultiplier, financialPct } = useAppStore((s) => s.costSettings);
  const rates = useAppStore((s) => s.hourRates);
  const [state, setState] = useState<CalcState>(() => initialCalcState(financialPct));
  const [projectType, setProjectType] = useState<string>(PROJECT_TYPES[0]);
  const [startDate, setStartDate] = useState(todayISO());
  /** Fecha de entrega comprometida (opcional). */
  const [deadline, setDeadline] = useState("");
  const [salesPrice, setSalesPrice] = useState(0);
  const [error, setError] = useState("");

  const calc = useMemo(
    () => computeCalculator(state, startDate, projectType, { projects, rates, deadline, overtimeMultiplier, salesPrice }),
    [state, startDate, projectType, projects, rates, deadline, overtimeMultiplier, salesPrice],
  );
  const profit = profitOrNull(salesPrice, calc.total);
  const margin = marginPercent(salesPrice - calc.total, salesPrice);
  const workDays = calc.schedule.workDays;

  const toProject = () => {
    if (!calc.hasContent) return setError("Cargá al menos un material, horas de trabajo o un costo para armar la cotización.");
    if (!(salesPrice > 0)) return setError("Definí el precio de venta (podés usar el sugerido) para crear el proyecto.");
    setError("");
    // Sin fecha comprometida, Nuevo proyecto propone una (inicio + días de trabajo) para que se confirme ahí.
    setQuoteDraft({ state, projectType, startDate, dueDate: deadline || (workDays > 0 ? addWorkingDays(startDate, workDays) : in30days()), salesPrice });
    router.push("/projects/new");
  };

  const reset = () => {
    setState(initialCalcState(financialPct));
    setSalesPrice(0);
    setDeadline("");
    setError("");
  };

  return (
    <div>
      <PageHeader
        back
        title="Cotizador"
        subtitle="Calculá el costo, el precio de venta y la rentabilidad antes de crear el proyecto. Si el cliente acepta, lo convertís en proyecto con un clic."
        actions={
          <Button variant="outline" onClick={reset}>
            <RotateCcw /> Empezar de nuevo
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-3">
              <Field label="Tipo de proyecto" htmlFor="q-type" hint="Se usa para comparar con tus proyectos anteriores del mismo tipo.">
                <Select id="q-type" value={projectType} onChange={(e) => setProjectType(e.target.value)}>
                  {PROJECT_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Fecha de inicio estimada" htmlFor="q-start">
                <Input id="q-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || todayISO())} />
              </Field>
              <Field label="Fecha de entrega comprometida (opcional)" htmlFor="q-deadline" hint="Con fecha se ve si los días de trabajo entran y, si no, las horas extra.">
                <Input id="q-deadline" type="date" value={deadline} min={startDate} onChange={(e) => setDeadline(e.target.value)} />
              </Field>
            </CardContent>
          </Card>
          <BudgetCalculator
            state={state}
            onState={setState}
            result={calc}
            projectType={projectType}
            salesPrice={salesPrice}
            onSalesPrice={setSalesPrice}
            deadline={deadline}
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Resumen de la cotización">
          <Card>
            <CardContent className="space-y-3 pt-5 text-sm">
              <Row label="Costo presupuestado" value={formatCurrency(calc.total)} />
              <Row label="Precio de venta" value={salesPrice > 0 ? formatCurrency(salesPrice) : "Sin definir"} />
              <Row label="Ganancia esperada" value={formatCurrencyOrDash(profit)} strong />
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs text-slate-500">Rentabilidad esperada</div>
                <div className={cn("text-3xl font-semibold tabular", margin !== null && margin < 15 ? "text-amber-700" : "text-slate-900")} aria-live="polite">
                  {salesPrice > 0 ? formatPercent(margin) : "—"}
                </div>
              </div>
              <Row label="Días de trabajo estimados" value={workDays > 0 ? formatWorkingDays(workDays) : "—"} />
              <Row label="Entrega comprometida" value={deadline ? formatDate(deadline) : "Sin fecha"} />
              {calc.schedule.fits === false && (
                <p role="alert" className="text-xs text-amber-800">Los días de trabajo no entran hasta la fecha de entrega: hay horas extra.</p>
              )}
              <Button className="w-full" onClick={toProject} disabled={!calc.hasContent || !(salesPrice > 0)}>
                Crear proyecto con esta cotización
              </Button>
              <p className="text-xs text-slate-500">Es una estimación hecha con lo que cargaste. Recién al crear el proyecto se convierte en su costo presupuestado; al aprobarlo, en el presupuesto base.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={cn("tabular", strong && "font-semibold text-slate-900")}>{value}</span>
    </div>
  );
}
