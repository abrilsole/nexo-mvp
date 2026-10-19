"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { PROJECT_TYPES } from "@/lib/constants";
import { parseDecimal, projectInfoSchema, type ProjectInfoValues } from "@/lib/schemas";
import { formatDate, formatWorkingDays, todayISO, toISODate } from "@/lib/formatting";
import { addWorkingDays } from "@/lib/budget-calculator";
import { workingDaysBetween } from "@/lib/capacity";
import { nextProjectCode } from "@/lib/project-operations";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QuoteWorkspace } from "@/components/budget/quote-workspace";
import { computeCalculator, initialCalcState, quoteActionBlocker, type CalcState } from "@/components/budget/calculator-state";
import { clearQuoteDraft, peekQuoteDraft } from "@/components/budget/quote-draft";
import { QuoteReview } from "./quote-review";
import { cn } from "@/lib/utils";

const STEPS = ["Datos del proyecto", "Costo presupuestado", "Revisar y crear"];

function in30days() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return toISODate(d);
}

/** Plazo de la cotización en días hábiles (0 = sin plazo). */
const plazoOf = (s: CalcState) => {
  const v = parseDecimal(s.deadlineDays);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

export function NewProjectWizard() {
  const router = useRouter();
  const projects = useAppStore((s) => s.projects);
  const { overtimeMultiplier, financialPct, hoursPerDay } = useAppStore((s) => s.costSettings);
  const rates = useAppStore((s) => s.hourRates);
  const isDemo = useAppStore((s) => s.isDemo);
  const createProject = useConfirmedAction("createProject");
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
      projectType: draft?.projectType || PROJECT_TYPES[0],
      description: "",
      startDate: todayISO(),
      // Con plazo en la cotización, la entrega propuesta es inicio + plazo; se puede cambiar.
      dueDate: draft && plazoOf(draft.state) > 0 ? addWorkingDays(todayISO(), plazoOf(draft.state)) : in30days(),
      owner: useAppStore.getState().userName,
      salesPrice: (draft?.salesPrice ?? undefined) as unknown as number,
    },
    mode: "onTouched",
  });
  const { register, formState, control, trigger, getValues, setValue } = form;
  const salesPrice = Number(useWatch({ control, name: "salesPrice" })) || 0;
  const startDate = useWatch({ control, name: "startDate" });
  const dueDate = useWatch({ control, name: "dueDate" });
  const projectType = useWatch({ control, name: "projectType" });
  const calc = useMemo(
    () => computeCalculator(calcState, projectType, { projects, rates, overtimeMultiplier, hoursPerDay, salesPrice, isDemo }),
    [calcState, projectType, projects, rates, overtimeMultiplier, hoursPerDay, salesPrice, isDemo],
  );
  const plazo = plazoOf(calcState);
  const suggestedDue = plazo > 0 && startDate ? addWorkingDays(startDate, plazo) : null;

  const toCost = async () => {
    if (!(await trigger(["name", "client", "projectType", "description", "startDate", "dueDate", "owner"]))) return;
    // Ya hay fechas del proyecto: si la cotización no tenía plazo, se propone el de esas fechas (editable).
    if (plazo === 0) {
      const days = workingDaysBetween(startDate, dueDate);
      if (days > 0) setCalcState({ ...calcState, deadlineDays: String(days) });
    }
    setStep(1);
  };

  const toReview = () => {
    const blocker = quoteActionBlocker(calc, salesPrice);
    if (blocker) return setPriceError(blocker);
    setPriceError("");
    setStep(2);
  };

  const submit = async () => {
    const blocker = quoteActionBlocker(calc, salesPrice);
    if (blocker) {
      setPriceError(blocker);
      return setStep(1);
    }
    const v = getValues();
    const res = await createProject({ ...v, salesPrice: Number(v.salesPrice), code, budgetLines: calc.lines });
    if (!res.ok) return setFormError(res.error);
    clearQuoteDraft();
    router.push(`/projects/${res.value}`);
  };

  return (
    <div>
      <PageHeader back="/projects" title="Nuevo proyecto" subtitle={`Código asignado: ${code}.`} />
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
            <Field label="Fecha de inicio" htmlFor="startDate" error={formState.errors.startDate?.message}>
              <Input id="startDate" type="date" {...register("startDate")} />
            </Field>
            <Field label="Fecha de entrega comprometida" htmlFor="dueDate" error={formState.errors.dueDate?.message}>
              <Input id="dueDate" type="date" {...register("dueDate")} aria-invalid={!!formState.errors.dueDate} />
            </Field>
            {suggestedDue && suggestedDue !== dueDate && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 sm:col-span-2">
                Con el plazo de la cotización ({formatWorkingDays(plazo)}) la entrega sería el {formatDate(suggestedDue)}.
                <Button size="sm" variant="outline" onClick={() => setValue("dueDate", suggestedDue, { shouldValidate: true })}>
                  Usar esa fecha
                </Button>
              </div>
            )}
            <Field label="Responsable" htmlFor="owner" error={formState.errors.owner?.message}>
              <Input id="owner" {...register("owner")} />
            </Field>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <QuoteWorkspace
          state={calcState}
          onState={setCalcState}
          result={calc}
          projectType={{ value: projectType }}
          salesPrice={salesPrice}
          priceError={priceError}
          onSalesPrice={(n) => {
            setValue("salesPrice", n, { shouldValidate: true });
            if (n > 0) setPriceError("");
          }}
          actionLabel="Continuar"
          onAction={toReview}
          context={
            <>
              {code} · {getValues("client") || "Sin cliente"} · entrega {formatDate(dueDate)}
            </>
          }
        />
      )}

      {step === 2 && (
        <div className="space-y-3">
          <QuoteReview info={{ ...getValues(), code }} calc={calc} salesPrice={salesPrice} />
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
        </div>
      )}

      <div className="mt-4 flex justify-between">
        <Button variant="outline" onClick={() => (step === 0 ? (clearQuoteDraft(), router.push("/projects")) : setStep(step - 1))}>
          {step === 0 ? "Cancelar" : "Atrás"}
        </Button>
        {step === 0 && <Button onClick={toCost}>Continuar</Button>}
        {step === 2 && <Button onClick={submit}>Crear proyecto</Button>}
      </div>
    </div>
  );
}
