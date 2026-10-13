"use client";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import type { AlertSettings } from "@/types";
import { APP_NAME, APP_SUBTITLE, COMPANY_NAME, DEFAULT_FINANCIAL_PCT, DEFAULT_OVERTIME_MULTIPLIER, DEFAULT_SETTINGS } from "@/lib/constants";
import { formatCurrency } from "@/lib/formatting";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const pct = z.number({ error: "Ingresá un número" }).min(0, "Mínimo 0").max(100, "Máximo 100");
const schema = z
  .object({
    categoryWarningPct: pct,
    categoryCriticalPct: pct,
    marginWarningPp: pct,
    marginCriticalPp: pct,
    daysWithoutRecords: z.number({ error: "Ingresá un número" }).int("Días enteros").min(1).max(90),
    dueSoonDays: z.number({ error: "Ingresá un número" }).int("Días enteros").min(0).max(60),
    deadlineNoProductionPct: pct,
  })
  .refine((v) => v.categoryCriticalPct > v.categoryWarningPct, { path: ["categoryCriticalPct"], message: "Debe ser mayor que el de atención" })
  .refine((v) => v.marginCriticalPp > v.marginWarningPp, { path: ["marginCriticalPp"], message: "Debe ser mayor que el de atención" });

type FieldDef = {
  key: keyof AlertSettings;
  label: string;
  hint: (v: AlertSettings) => string;
};

type Group = { title: string; description: string; fields: FieldDef[] };

const ARS = (x: number) => `$ ${Math.round(x).toLocaleString("es-AR")}`;
const PTS = (x: number) => `${Math.round(x * 10) / 10}`.replace(".", ",");

const GROUPS: Group[] = [
  {
    title: "Costos que se pasan del presupuesto",
    description: "Se compara el costo real de cada categoría (Materiales, Mano de obra, etc.) con lo presupuestado.",
    fields: [
      {
        key: "categoryWarningPct",
        label: "Pasa a Atención cuando se excede en (%)",
        hint: (v) =>
          `Ej.: si Materiales se presupuestó en ${ARS(1_000_000)}, pasa a Atención cuando el costo real supera ${ARS(1_000_000 * (1 + v.categoryWarningPct / 100))}.`,
      },
      {
        key: "categoryCriticalPct",
        label: "Pasa a En riesgo cuando se excede en (%)",
        hint: (v) =>
          `Ej.: en ese mismo caso, pasa a En riesgo cuando el costo real supera ${ARS(1_000_000 * (1 + v.categoryCriticalPct / 100))}.`,
      },
    ],
  },
  {
    title: "Caída de la rentabilidad",
    description: "Se compara la rentabilidad proyectada con la rentabilidad esperada. La diferencia se mide en puntos de rentabilidad.",
    fields: [
      {
        key: "marginWarningPp",
        label: "Pasa a Atención si la rentabilidad cae (puntos)",
        hint: (v) =>
          `Ej.: si la rentabilidad esperada era 40%, avisa cuando el proyectado baja a ${PTS(40 - v.marginWarningPp)}% o menos.`,
      },
      {
        key: "marginCriticalPp",
        label: "Pasa a En riesgo si la rentabilidad cae (puntos)",
        hint: (v) =>
          `Ej.: con el mismo 40% esperado, es En riesgo cuando el proyectado baja de ${PTS(40 - v.marginCriticalPp)}%.`,
      },
    ],
  },
  {
    title: "Plazos y registros",
    description: "Avisos para que no se pase por alto un proyecto que no se está cargando o que se acerca a la entrega.",
    fields: [
      {
        key: "daysWithoutRecords",
        label: "Días sin registros",
        hint: (v) =>
          `Ej.: un proyecto en Producción al que hace ${v.daysWithoutRecords} días o más no se le carga ningún consumo ni costo genera un aviso.`,
      },
      {
        key: "dueSoonDays",
        label: "Días antes de la entrega",
        hint: (v) => `Ej.: desde ${v.dueSoonDays} días antes de la fecha de entrega, el proyecto muestra un aviso de entrega cercana.`,
      },
      {
        key: "deadlineNoProductionPct",
        label: "Plazo transcurrido sin llegar a Producción (%)",
        hint: (v) =>
          `Ej.: si ya pasó el ${v.deadlineNoProductionPct}% del plazo total y el proyecto todavía no llegó a Producción, avisa.`,
      },
    ],
  },
];

function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const resetSettings = useAppStore((s) => s.resetSettings);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const clearData = useAppStore((s) => s.clearData);
  const organizationName = useAppStore((s) => s.organizationName);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const { register, handleSubmit, reset, control, formState } = useForm<AlertSettings>({
    resolver: zodResolver(schema),
    defaultValues: settings,
  });

  const confirmWord = organizationName.trim() || "VACIAR";
  const canClear = confirmText.trim().toLowerCase() === confirmWord.toLowerCase();

  // Valores en vivo para que los ejemplos se actualicen mientras se escribe.
  const raw = useWatch({ control });
  const live: AlertSettings = {
    categoryWarningPct: numOr(raw.categoryWarningPct, settings.categoryWarningPct),
    categoryCriticalPct: numOr(raw.categoryCriticalPct, settings.categoryCriticalPct),
    marginWarningPp: numOr(raw.marginWarningPp, settings.marginWarningPp),
    marginCriticalPp: numOr(raw.marginCriticalPp, settings.marginCriticalPp),
    daysWithoutRecords: numOr(raw.daysWithoutRecords, settings.daysWithoutRecords),
    dueSoonDays: numOr(raw.dueSoonDays, settings.dueSoonDays),
    deadlineNoProductionPct: numOr(raw.deadlineNoProductionPct, settings.deadlineNoProductionPct),
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Configuración" subtitle={`${APP_NAME} · ${APP_SUBTITLE} · ${organizationName}`} />

      <Card>
        <CardHeader>
          <CardTitle>Cuándo avisar</CardTitle>
          <CardDescription>
            Estos números definen cuándo un desvío se considera Atención o En riesgo. Al guardar, se recalculan todas las
            pantallas al instante. No modifican ningún costo ni registro, solo cómo se clasifican.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={handleSubmit((v) => {
              updateSettings(v);
              setSaved(true);
              setTimeout(() => setSaved(false), 2500);
            })}
            className="space-y-8"
          >
            {GROUPS.map((g) => (
              <section key={g.title} aria-labelledby={`grp-${g.title}`}>
                <h3 id={`grp-${g.title}`} className="text-sm font-semibold text-slate-900">
                  {g.title}
                </h3>
                <p className="mb-3 mt-0.5 text-sm text-slate-500">{g.description}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {g.fields.map((f) => (
                    <Field key={f.key} label={f.label} htmlFor={f.key} hint={f.hint(live)} error={formState.errors[f.key]?.message}>
                      <Input id={f.key} type="number" step="any" {...register(f.key, { valueAsNumber: true })} aria-invalid={!!formState.errors[f.key]} />
                    </Field>
                  ))}
                </div>
              </section>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit">Guardar</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetSettings();
                  reset(DEFAULT_SETTINGS);
                }}
              >
                Restaurar valores por defecto
              </Button>
              {saved && (
                <span role="status" className="text-sm text-emerald-700">
                  Guardado
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <HourRatesCard />
      <OvertimeCard />
      <FinancialCard />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Cómo se clasifica cada proyecto</CardTitle>
          <CardDescription>Es una regla fija: usa las alertas abiertas del proyecto (costos, rentabilidad, plazos y material sin destino). Los finalizados no llevan esta etiqueta.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-slate-700">
            <li>
              <span className="font-semibold text-red-700">En riesgo:</span> tiene al menos una alerta crítica abierta.
            </li>
            <li>
              <span className="font-semibold text-amber-700">Atención:</span> tiene alertas de atención abiertas y ninguna crítica.
            </li>
            <li>
              <span className="font-semibold text-emerald-700">Sin desvíos:</span> hay datos registrados y no hay alertas abiertas.
            </li>
            <li>
              <span className="font-semibold text-slate-600">Sin datos todavía:</span> aún no se cargó ningún consumo ni costo.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="mt-6 border-red-200">
        <CardHeader>
          <CardTitle className="text-red-800">Zona de riesgo</CardTitle>
          <CardDescription>
            Estas acciones reemplazan o borran los datos de tu empresa. Los datos se guardan en tu cuenta y no se pueden
            recuperar después.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Restaurar datos demo</h3>
            <p className="mb-3 mt-0.5 text-sm text-slate-500">
              Vuelve a cargar los proyectos de ejemplo de {COMPANY_NAME}. Se pierden los registros cargados.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("¿Restaurar los datos demo? Se perderán los registros cargados.")) return;
                setBusy(true);
                const res = await resetDemo();
                setBusy(false);
                if (res.ok) reset(DEFAULT_SETTINGS);
              }}
            >
              Reset demo
            </Button>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <h3 className="text-sm font-semibold text-slate-900">Vaciar todos los datos</h3>
            <p className="mb-3 mt-0.5 text-sm text-slate-500">
              Borra todos los proyectos, registros y sobrantes para empezar con tus proyectos reales.
            </p>
            <Field label={`Para confirmar, escribí: ${confirmWord}`} htmlFor="confirm-clear">
              <Input
                id="confirm-clear"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Button
              className="mt-3"
              variant="destructive"
              disabled={busy || !canClear}
              onClick={async () => {
                setBusy(true);
                const res = await clearData();
                setBusy(false);
                if (res.ok) {
                  reset(DEFAULT_SETTINGS);
                  setConfirmText("");
                }
              }}
            >
              Vaciar datos
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Tarifas por tipo de hora: solo las ve y las cambia Gestión (Taller nunca las recibe). */
function HourRatesCard() {
  const rates = useAppStore((s) => s.hourRates);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Tipos de hora y tarifas</CardTitle>
        <CardDescription>
          El Cotizador valoriza las horas de cada rubro con la tarifa de su tipo de hora. Cada cotización guarda la tarifa vigente al momento de
          hacerla: cambiarla acá no modifica las cotizaciones ni los proyectos ya creados. Los valores iniciales son los del cliente piloto.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rates.map((r) => (
          <HourRateRow key={r.id} id={r.id} name={r.name} hourlyRate={r.hourlyRate} />
        ))}
        <p className="text-xs text-slate-500">
          No cambia cómo se calcula el costo real de las horas cargadas desde Taller: ese sigue saliendo del costo por hora de cada operario.
        </p>
      </CardContent>
    </Card>
  );
}

function HourRateRow({ id, name, hourlyRate }: { id: string; name: string; hourlyRate: number }) {
  const updateHourRate = useAppStore((s) => s.updateHourRate);
  const [value, setValue] = useState(String(hourlyRate));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const res = updateHourRate(id, parseDecimal(value));
        if (!res.ok) return setError(res.error);
        setError("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }}
    >
      <Field label={`${name} (por hora)`} htmlFor={`rate-${id}`} error={error || undefined} className="w-full sm:max-w-xs">
        <Input id={`rate-${id}`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
      </Field>
      <Button type="submit" variant="outline">Guardar</Button>
      {saved && (
        <span role="status" className="text-sm text-emerald-700">
          Guardado: {formatCurrency(hourlyRate)} por hora
        </span>
      )}
    </form>
  );
}

/** Gasto financiero por defecto del Cotizador (a confirmar con el cliente). Solo Gestión. */
function FinancialCard() {
  const financialPct = useAppStore((s) => s.costSettings.financialPct);
  const updateCostSettings = useAppStore((s) => s.updateCostSettings);
  const [value, setValue] = useState(() => String(financialPct).replace(".", ","));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const save = (pct: number) => {
    const res = updateCostSettings({ financialPct: pct });
    if (!res.ok) return setError(res.error);
    setError("");
    setValue(String(pct).replace(".", ","));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Gasto financiero</CardTitle>
        <CardDescription>
          Porcentaje sobre el precio de venta. Es un costo: aparece como línea &quot;Gasto financiero&quot; en el costo presupuestado. Es el valor con el que
          arranca cada cotización; en el Cotizador se puede cambiar. El 5% inicial es un supuesto a confirmar con el cliente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(parseDecimal(value));
          }}
        >
          <Field label="Gasto financiero (% del precio de venta)" htmlFor="financial-pct" error={error || undefined} className="w-full sm:max-w-sm">
            <Input id="financial-pct" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
          </Field>
          <Button type="submit">Guardar</Button>
          <Button type="button" variant="outline" onClick={() => save(DEFAULT_FINANCIAL_PCT)}>
            Volver a {DEFAULT_FINANCIAL_PCT}%
          </Button>
          {saved && (
            <span role="status" className="text-sm text-emerald-700">
              Guardado
            </span>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** Multiplicador de horas extra: solo lo ve y lo cambia Gestión (Taller nunca lo recibe). */
function OvertimeCard() {
  const multiplier = useAppStore((s) => s.costSettings.overtimeMultiplier);
  const updateCostSettings = useAppStore((s) => s.updateCostSettings);
  const [value, setValue] = useState(() => String(multiplier).replace(".", ","));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const live = parseDecimal(value);
  const example = Number.isFinite(live) && live >= 1 ? live : multiplier;

  const save = (m: number) => {
    const res = updateCostSettings({ overtimeMultiplier: m });
    if (!res.ok) return setError(res.error);
    setError("");
    setValue(String(m).replace(".", ","));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Horas extra</CardTitle>
        <CardDescription>
          En el Cotizador, si los días de trabajo no entran hasta la fecha de entrega comprometida, las horas que no entran se calculan como horas
          extra: tarifa por hora × este multiplicador. Suman a Mano de obra.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(parseDecimal(value));
          }}
        >
          <Field
            label="Multiplicador de horas extra"
            htmlFor="overtime-multiplier"
            error={error || undefined}
            hint={`Ej.: con $ 10.000 por hora, la hora extra cuesta ${formatCurrency(10_000 * example)}. Por defecto ${DEFAULT_OVERTIME_MULTIPLIER}; por ejemplo 1,5 para días hábiles.`}
            className="w-full sm:max-w-sm"
          >
            <Input id="overtime-multiplier" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
          </Field>
          <Button type="submit">Guardar</Button>
          <Button type="button" variant="outline" onClick={() => save(DEFAULT_OVERTIME_MULTIPLIER)}>
            Volver a {DEFAULT_OVERTIME_MULTIPLIER}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-emerald-700">
              Guardado
            </span>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
