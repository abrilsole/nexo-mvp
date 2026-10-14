"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { PROJECT_TYPES } from "@/lib/constants";
import { projectInfoSchema, type ProjectInfoValues } from "@/lib/schemas";
import { formatCurrency, formatCurrencyOrDash, formatPercent, todayISO, toISODate } from "@/lib/formatting";
import { marginPercent, profitOrNull } from "@/lib/calculations";
import { nextProjectCode, type BudgetLineInput } from "@/lib/project-operations";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BudgetCalculator } from "@/components/budget/budget-calculator";
import { computeCalculator, initialCalcState, type CalcState } from "@/components/budget/calculator-state";
import { clearQuoteDraft, peekQuoteDraft } from "@/components/budget/quote-draft";
import { QuoteReview } from "./quote-review";
import { cn } from "@/lib/utils";

const STEPS = ["Datos del proyecto", "Costo presupuestado", "Revisar y crear"];

function in30days() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return toISODate(d);
}

export function NewProjectWizard() {
  const router = useRouter();
  const projects = useAppStore((s) => s.projects);
  const { overtimeMultiplier, financialPct } = useAppStore((s) => s.costSettings);
  const rates = useAppStore((s) => s.hourRates);
  const createProject = useAppStore((s) => s.createProject);
  const code = useMemo(() => nextProjectCode(projects), [projects]);
  const [draft] = useState(peekQuoteDraft);
  const [step, setStep] = useState(0);
  const [calcState, setCalcState] = useState<CalcState>(() => draft?.state ?? initialCalcState(financialPct));
  const [priceError, setPriceError] = useState("");
  const [formError, setFormError] = useState("");

  const form = useForm<ProjectInfoValues>({
    resolver: zodResolver(projectInfoSchema),
    defaultValues: {
      name: "",
      client: "",
      projectType: draft?.projectType ?? PROJECT_TYPES[0],
      description: "",
      startDate: draft?.startDate ?? todayISO(),
      dueDate: draft?.dueDate ?? in30days(),
      owner: useAppStore.getState().userName,
      salesPrice: (draft?.salesPrice ?? undefined) as unknown as number,
    },
    mode: "onTouched",
  });
  const { register, formState, control, trigger, getValues, setValue } = form;
  const salesPrice = Number(useWatch({ control, name: "salesPrice" })) || 0;
  const startDate = useWatch({ control, name: "startDate" });
  const projectType = useWatch({ control, name: "projectType" });
  const dueDate = useWatch({ control, name: "dueDate" });
  const calc = useMemo(
    () => computeCalculator(calcState, startDate, projectType, { projects, rates, deadline: dueDate, overtimeMultiplier, salesPrice }),
    [calcState, startDate, projectType, projects, rates, dueDate, overtimeMultiplier, salesPrice],
  );
  const budget = calc.total;
  const profit = profitOrNull(salesPrice, budget);
  const margin = marginPercent(salesPrice - budget, salesPrice);

  /** El costo presupuestado sale siempre de la calculadora guiada. */
  const validateLines = (): BudgetLineInput[] | null => {
    if (calc.lines.length === 0) {
      setFormError("Cargá al menos un material, horas de trabajo o un costo para armar el costo presupuestado.");
      return null;
    }
    setFormError("");
    return calc.lines;
  };

  const next = async () => {
    if (step === 0 && !(await trigger(["name", "client", "projectType", "description", "startDate", "dueDate", "owner"]))) return;
    if (step === 1) {
      if (!validateLines()) return;
      if (!(salesPrice > 0)) return setPriceError("Definí el precio de venta (podés usar el sugerido) para continuar.");
      setPriceError("");
    }
    setStep((s) => s + 1);
  };

  const submit = () => {
    const inputs = validateLines();
    if (!inputs) return setStep(1);
    if (!(salesPrice > 0)) {
      setPriceError("Definí el precio de venta para crear el proyecto.");
      return setStep(1);
    }
    const v = getValues();
    const res = createProject({ ...v, salesPrice: Number(v.salesPrice), code, budgetLines: inputs });
    if (!res.ok) return setFormError(res.error);
    clearQuoteDraft();
    router.push(`/projects/${res.value}`);
  };

  return (
    <div>
      <PageHeader back="/projects" title="Nuevo proyecto" subtitle={`Código asignado: ${code}. El costo presupuestado que cargues, una vez aprobado, será el presupuesto base contra el que se miden los desvíos.`} />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
              i === step ? "border-blue-600 bg-blue-50 font-medium text-blue-800" : i < step ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500",
            )}
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-white text-xs tabular">{i < step ? <Check className="size-3" /> : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <div className={cn("grid gap-6", step === 1 && "lg:grid-cols-[1fr_300px]")}>
        <div>
          {step === 0 && (
            <Card>
              <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
                <Field label="Nombre" htmlFor="name" error={formState.errors.name?.message} className="sm:col-span-2">
                  <Input id="name" {...register("name")} aria-invalid={!!formState.errors.name} placeholder="Ej.: Local Palermo – Mobiliario comercial" />
                </Field>
                <Field label="Cliente" htmlFor="client" error={formState.errors.client?.message}>
                  <Input id="client" {...register("client")} aria-invalid={!!formState.errors.client} />
                </Field>
                <Field label="Tipo" htmlFor="projectType" error={formState.errors.projectType?.message}>
                  <Select id="projectType" {...register("projectType")}>
                    {PROJECT_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Descripción" htmlFor="description" className="sm:col-span-2">
                  <Textarea id="description" {...register("description")} />
                </Field>
                <Field label="Fecha inicio" htmlFor="startDate" error={formState.errors.startDate?.message}>
                  <Input id="startDate" type="date" {...register("startDate")} />
                </Field>
                <Field label="Fecha de entrega comprometida" htmlFor="dueDate" error={formState.errors.dueDate?.message} hint="Con esta fecha se ve si los días de trabajo entran y, si no, las horas extra.">
                  <Input id="dueDate" type="date" {...register("dueDate")} aria-invalid={!!formState.errors.dueDate} />
                </Field>
                <Field label="Responsable" htmlFor="owner" error={formState.errors.owner?.message}>
                  <Input id="owner" {...register("owner")} />
                </Field>
              </CardContent>
            </Card>
          )}
          {step === 1 && (
            <div className="space-y-4">
              {draft && (
                <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">Partís de la cotización que armaste en el Cotizador. Podés ajustarla antes de crear el proyecto.</p>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>Costo presupuestado</CardTitle>
                  <p className="text-sm text-slate-500">
                    Armalo por rubros: materiales, operarios × horas, horas de diseño y de administración de cada rubro, más transporte e imprevistos. Te sugiere un precio de venta y, una vez aprobado, es el presupuesto base contra el que se miden los desvíos.
                  </p>
                </CardHeader>
              </Card>
              <BudgetCalculator
                  state={calcState}
                  onState={setCalcState}
                  result={calc}
                  projectType={projectType}
                  salesPrice={salesPrice}
                  priceError={priceError}
                  onSalesPrice={(n) => {
                    setValue("salesPrice", n, { shouldValidate: true });
                    if (n > 0) setPriceError("");
                  }}
                  deadline={dueDate}
                />
              {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            </div>
          )}
          {step === 2 && (
            <div className="space-y-3">
              <QuoteReview
                info={{ ...getValues(), code }}
                calc={calc}
                salesPrice={salesPrice}
              />
              {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            </div>
          )}
          <div className="mt-4 flex justify-between">
            <Button variant="outline" onClick={() => (step === 0 ? (clearQuoteDraft(), router.push("/projects")) : setStep(step - 1))}>
              {step === 0 ? "Cancelar" : "Atrás"}
            </Button>
            {step < 2 ? <Button onClick={next}>Continuar</Button> : <Button onClick={submit}>Crear proyecto</Button>}
          </div>
        </div>

        {/* En "Revisar y crear" el resultado ya está en el resumen: no se repite al costado. */}
        {step === 1 && <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Resumen económico">
          <Card>
            <CardContent className="space-y-3 pt-5 text-sm">
              <Row label="Precio de venta" value={salesPrice > 0 ? formatCurrency(salesPrice) : "Sin definir"} />
              <Row label="Costo presupuestado" value={formatCurrency(budget)} />
              <Row label="Ganancia esperada" value={formatCurrencyOrDash(profit)} strong />
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs text-slate-500">Rentabilidad esperada</div>
                <div className={cn("text-3xl font-semibold tabular", margin !== null && margin < 15 ? "text-amber-700" : "text-slate-900")} aria-live="polite">
                  {formatPercent(margin)}
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>}
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
