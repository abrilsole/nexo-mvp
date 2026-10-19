"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
// Configuración en pestañas: Alertas · Tarifas y horas · Costos · Usuarios · Datos (solo Administrativo).
// Cada sección tiene un solo "Guardar", avisa si hay cambios sin guardar y puede volver a los valores por defecto.
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { AlertSettings, HourRate, LaborValuation } from "@/types";
import {
  APP_NAME,
  APP_SUBTITLE,
  COMPANY_NAME,
  DEFAULT_FINANCIAL_PCT,
  DEFAULT_HOUR_RATES,
  DEFAULT_HOURS_PER_DAY,
  DEFAULT_OVERTIME_MULTIPLIER,
  DEFAULT_SETTINGS,
  MATERIAL_CATALOG,
} from "@/lib/constants";
import { costSettingsError, hourRatesError } from "@/lib/cost-settings";
import { formatCurrency, formatNumber, todayISO } from "@/lib/formatting";
import { OVERTIME_SUBJECT } from "@/lib/price-history";
import { catalogPriceAt } from "@/lib/material-options";
import { parseDecimal } from "@/lib/schemas";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Choice } from "@/components/ui/choice";
import { PriceHistoryList } from "./price-history-list";
import { UsersSection } from "./users-section";

// ── Piezas comunes de cada sección ───────────────────────────

/** Estado visible del guardado: cambios sin guardar o confirmación de que se guardó. */
function SaveStatus({ dirty, saved, error }: { dirty: boolean; saved: boolean; error?: string }) {
  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (dirty) return <p role="status" className="text-sm text-amber-800">Hay cambios sin guardar.</p>;
  if (saved) return <p role="status" className="text-sm text-emerald-700">Cambios guardados.</p>;
  return null;
}

function SectionActions({ onRestore, dirty, saved, error }: { onRestore: () => void; dirty: boolean; saved: boolean; error?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
      <Button type="submit">Guardar</Button>
      <Button type="button" variant="outline" onClick={onRestore}>
        Restaurar valores por defecto
      </Button>
      <SaveStatus dirty={dirty} saved={saved} error={error} />
    </div>
  );
}

const asText = (n: number) => String(n).replace(".", ",");

// ── Alertas ──────────────────────────────────────────────────

const pct = z.number({ error: "Ingresá un número" }).min(0, "Mínimo 0").max(100, "Máximo 100");
const alertsSchema = z
  .object({
    categoryWarningPct: pct,
    categoryCriticalPct: pct,
    marginWarningPp: pct,
    marginCriticalPp: pct,
    daysWithoutRecords: z.number({ error: "Ingresá un número" }).int("Días enteros").min(1).max(90),
    dueSoonDays: z.number({ error: "Ingresá un número" }).int("Días enteros").min(0).max(60),
    deadlineNoProductionPct: pct,
    hoursDeviationPct: z.number({ error: "Ingresá un número" }).min(1, "Mínimo 1").max(500, "Máximo 500"),
    hoursDeviationHours: z.number({ error: "Ingresá un número" }).min(0.5, "Mínimo 0,5").max(24, "Máximo 24"),
    purchaseLeadDays: z.number({ error: "Ingresá un número" }).int("Días enteros").min(1, "Mínimo 1").max(60, "Máximo 60"),
  })
  .refine((v) => v.categoryCriticalPct > v.categoryWarningPct, { path: ["categoryCriticalPct"], message: "Debe ser mayor que el de atención" })
  .refine((v) => v.marginCriticalPp > v.marginWarningPp, { path: ["marginCriticalPp"], message: "Debe ser mayor que el de atención" });

type AlertField = { key: keyof AlertSettings; label: string; help: (v: AlertSettings) => string };
type AlertGroup = { title: string; help: string; fields: AlertField[] };

const PTS = (x: number) => formatNumber(Math.round(x * 10) / 10, 1);

const ALERT_GROUPS: AlertGroup[] = [
  {
    title: "Costos que se pasan del presupuesto",
    help: "Se compara el costo real de cada categoría (Materiales, Mano de obra, etc.) con el costo presupuestado.",
    fields: [
      {
        key: "categoryWarningPct",
        label: "Atención si se excede en (%)",
        help: (v) =>
          `Por ejemplo, si Materiales se presupuestó en ${formatCurrency(1_000_000)}, pasa a Atención cuando el costo real supera ${formatCurrency(1_000_000 * (1 + v.categoryWarningPct / 100))}.`,
      },
      {
        key: "categoryCriticalPct",
        label: "En riesgo si se excede en (%)",
        help: (v) => `En ese mismo caso, pasa a En riesgo cuando el costo real supera ${formatCurrency(1_000_000 * (1 + v.categoryCriticalPct / 100))}.`,
      },
    ],
  },
  {
    title: "Caída de la rentabilidad",
    help: "Se compara la rentabilidad proyectada con la rentabilidad esperada. La diferencia se mide en puntos de rentabilidad.",
    fields: [
      {
        key: "marginWarningPp",
        label: "Atención si cae (puntos)",
        help: (v) => `Si la rentabilidad esperada era 40%, avisa cuando la proyectada baja a ${PTS(40 - v.marginWarningPp)}% o menos.`,
      },
      {
        key: "marginCriticalPp",
        label: "En riesgo si cae (puntos)",
        help: (v) => `Con el mismo 40% esperado, es En riesgo cuando la proyectada baja de ${PTS(40 - v.marginCriticalPp)}%.`,
      },
    ],
  },
  {
    title: "Plazos y registros",
    help: "Avisos para que no se pase por alto un proyecto que no se está cargando o que se acerca a la entrega.",
    fields: [
      {
        key: "daysWithoutRecords",
        label: "Días sin registros",
        help: (v) => `Un proyecto en Producción al que hace ${v.daysWithoutRecords} días o más no se le carga ningún consumo ni costo genera un aviso.`,
      },
      {
        key: "dueSoonDays",
        label: "Días antes de la entrega",
        help: (v) => `Desde ${v.dueSoonDays} días antes de la fecha de entrega, el proyecto muestra un aviso de entrega cercana.`,
      },
      {
        key: "deadlineNoProductionPct",
        label: "Plazo transcurrido sin llegar a Producción (%)",
        help: (v) => `Si ya pasó el ${v.deadlineNoProductionPct}% del plazo total y el proyecto todavía no llegó a Producción, avisa.`,
      },
    ],
  },
  {
    title: "Desvío de horas (supuesto a ajustar con el cliente)",
    help: "Se comparan las horas cargadas con las previstas: las de la asignación del día y las estimadas para el rubro en el presupuesto. Avisa al Jefe de planta y al Administrativo, no al operario. El valor inicial (25 % o 2 h, lo que ocurra primero) es un supuesto.",
    fields: [
      {
        key: "hoursDeviationPct",
        label: "Avisar si se pasa en (%)",
        help: (v) => `Si se previeron 8 h, avisa desde ${PTS(8 * (1 + v.hoursDeviationPct / 100))} h cargadas (o antes, si se cumple el de horas).`,
      },
      {
        key: "hoursDeviationHours",
        label: "…o en (horas)",
        help: (v) => `Si se previeron 4 h, avisa desde ${PTS(4 + v.hoursDeviationHours)} h cargadas (o antes, si se cumple el %).`,
      },
    ],
  },
  {
    title: "Compras (supuesto a ajustar con el cliente)",
    help: "El material de un proyecto se necesita para el día de inicio. Avisa a Compras (y al Administrativo) lo que todavía no se compró y se necesita en pocos días. Los 7 días iniciales son un supuesto.",
    fields: [
      {
        key: "purchaseLeadDays",
        label: "Avisar material sin comprar con (días de anticipación)",
        help: (v) => `Un proyecto que arranca en ${v.purchaseLeadDays} días o menos y tiene materiales pendientes o cotizando genera un aviso.`,
      },
    ],
  },
];

const numOr = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

function AlertsSection() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useConfirmedAction("updateSettings");
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, reset, control, formState } = useForm<AlertSettings>({ resolver: zodResolver(alertsSchema), defaultValues: settings });
  const raw = useWatch({ control });
  // Valores en vivo para que las explicaciones se actualicen mientras se escribe.
  const live = Object.fromEntries(
    (Object.keys(DEFAULT_SETTINGS) as Array<keyof AlertSettings>).map((k) => [k, numOr(raw[k], settings[k])]),
  ) as unknown as AlertSettings;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cuándo avisar</CardTitle>
        <CardDescription>Definen cuándo un desvío es Atención o En riesgo. No cambian ningún costo ni registro.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={handleSubmit(async (v) => {
            const result = await updateSettings(v);
            if (!result.ok) return;
            reset(v);
            setSaved(true);
          })}
          className="space-y-8"
        >
          {ALERT_GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                {g.title}
                <HelpTip label={g.title}>{g.help}</HelpTip>
              </legend>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <label htmlFor={f.key} className="text-sm font-medium text-slate-700">{f.label}</label>
                      <HelpTip label={f.label}>{f.help(live)}</HelpTip>
                    </div>
                    <Input id={f.key} type="number" step="any" {...register(f.key, { valueAsNumber: true })} aria-invalid={!!formState.errors[f.key]} />
                    {formState.errors[f.key] && <p role="alert" className="text-xs text-red-600">{formState.errors[f.key]?.message}</p>}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          <SectionActions onRestore={() => reset(DEFAULT_SETTINGS, { keepDefaultValues: true })} dirty={formState.isDirty} saved={saved} />
        </form>
      </CardContent>
    </Card>
  );
}

// ── Tarifas y horas ──────────────────────────────────────────

interface RatesForm {
  rates: Record<string, string>;
  overtimeMultiplier: string;
  hoursPerDay: string;
}

const ratesFormOf = (rates: HourRate[], overtimeMultiplier: number, hoursPerDay: number): RatesForm => ({
  rates: Object.fromEntries(rates.map((r) => [r.id, asText(r.hourlyRate)])),
  overtimeMultiplier: asText(overtimeMultiplier),
  hoursPerDay: asText(hoursPerDay),
});

const sameForm = (a: RatesForm, b: RatesForm) => JSON.stringify(a) === JSON.stringify(b);

function RatesSection() {
  const hourRates = useAppStore((s) => s.hourRates);
  const { overtimeMultiplier, hoursPerDay, laborValuation } = useAppStore((s) => s.costSettings);
  const saveHourRates = useConfirmedAction("saveHourRates");
  const updateCostSettings = useConfirmedAction("updateCostSettings");
  const costSettings = useAppStore((s) => s.costSettings);
  const stored = ratesFormOf(hourRates, overtimeMultiplier, hoursPerDay);
  const [form, setForm] = useState<RatesForm>(stored);
  const [validFrom, setValidFrom] = useState(todayISO());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const dirty = !sameForm(form, stored);

  const save = async () => {
    const rates = hourRates.map((r) => ({ ...r, hourlyRate: parseDecimal(form.rates[r.id] ?? "") }));
    const next = { ...costSettings, overtimeMultiplier: parseDecimal(form.overtimeMultiplier), hoursPerDay: parseDecimal(form.hoursPerDay) };
    const problem = hourRatesError(rates) ?? costSettingsError(next);
    if (problem) return setError(problem);
    const r1 = await saveHourRates(rates, validFrom);
    if (!r1.ok) return setError(r1.error);
    const r2 = await updateCostSettings({ overtimeMultiplier: next.overtimeMultiplier, hoursPerDay: next.hoursPerDay }, validFrom);
    if (!r2.ok) return setError(r2.error);
    // Con fecha futura, lo que se ve hoy sigue siendo el valor de hoy.
    const now = useAppStore.getState();
    setForm(ratesFormOf(now.hourRates, now.costSettings.overtimeMultiplier, now.costSettings.hoursPerDay));
    setError("");
    setSaved(true);
  };

  const multiplier = parseDecimal(form.overtimeMultiplier);
  const future = validFrom > todayISO();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1">
            Tarifas y horas
            <HelpTip label="Tarifas y horas">
              <span className="block">Valores de ejemplo, editables.</span>
              <span className="block">
                Cada cambio vale desde la fecha que indiques y queda en el historial: el pasado no se modifica. Lo ya cotizado y las horas ya cargadas
                conservan su valor. Un cambio con fecha futura recién se usa desde ese día.
              </span>
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <fieldset>
              <legend className="text-sm font-semibold text-slate-900">Tipos de hora (tarifa por hora)</legend>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {hourRates.map((r) => (
                  <div key={r.id} className="space-y-1">
                    <Field label={r.name} htmlFor={`rate-${r.id}`}>
                      <Input
                        id={`rate-${r.id}`}
                        inputMode="decimal"
                        value={form.rates[r.id] ?? ""}
                        onChange={(e) => setForm({ ...form, rates: { ...form.rates, [r.id]: e.target.value } })}
                      />
                    </Field>
                    <PriceHistoryList kind="hour_rate" subjectId={r.id} label={r.name} />
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label htmlFor="overtime-multiplier" className="text-sm font-medium text-slate-700">Multiplicador de horas extra</label>
                  <HelpTip label="Multiplicador de horas extra">
                    Si los días de trabajo no entran en el plazo, las horas que no entran cuestan tarifa × este multiplicador
                    {Number.isFinite(multiplier) && multiplier >= 1 ? ` (con ${formatCurrency(10_000)} por hora, la hora extra cuesta ${formatCurrency(10_000 * multiplier)})` : ""}.
                    Entre 1 y 5; por ejemplo 1,5 para días hábiles.
                  </HelpTip>
                </div>
                <Input id="overtime-multiplier" inputMode="decimal" value={form.overtimeMultiplier} onChange={(e) => setForm({ ...form, overtimeMultiplier: e.target.value })} />
                <PriceHistoryList kind="overtime_multiplier" subjectId={OVERTIME_SUBJECT} label="Multiplicador de horas extra" format={(v) => `× ${formatNumber(v, 2)}`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label htmlFor="hours-per-day" className="text-sm font-medium text-slate-700">Jornada del operario (horas por día)</label>
                  <HelpTip label="Jornada del operario">
                    Se usa para los días de trabajo, las horas extra, la capacidad y el costo de cada día de atraso. Entre 1 y 24 horas. Cada cotización guarda la
                    jornada con la que se hizo.
                  </HelpTip>
                </div>
                <Input id="hours-per-day" inputMode="decimal" value={form.hoursPerDay} onChange={(e) => setForm({ ...form, hoursPerDay: e.target.value })} />
              </div>
            </div>
            <div className="max-w-xs">
              <Field label="Vigente desde" htmlFor="rates-valid-from" hint="Por defecto, hoy. Vale para las tarifas y el multiplicador que cambies.">
                <Input id="rates-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </Field>
              {future && dirty && <p className="mt-1 text-xs text-blue-700">Cambio programado: hasta esa fecha se sigue usando el valor actual.</p>}
            </div>
            <SectionActions
              onRestore={() => setForm(ratesFormOf(DEFAULT_HOUR_RATES, DEFAULT_OVERTIME_MULTIPLIER, DEFAULT_HOURS_PER_DAY))}
              dirty={dirty}
              saved={saved}
              error={error}
            />
          </form>
        </CardContent>
      </Card>

      <LaborValuationCard value={laborValuation} />
      <MaterialPricesCard />
    </div>
  );
}

/** Cómo se valúan las horas reales: hipótesis a confirmar con el cliente; el modelo admite las dos. */
function LaborValuationCard({ value }: { value: LaborValuation }) {
  const updateCostSettings = useConfirmedAction("updateCostSettings");
  const [error, setError] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Costo real de las horas <Badge tone="yellow">Hipótesis a confirmar con el cliente</Badge>
        </CardTitle>
        <CardDescription>
          Con qué valor se calcula el costo real de las horas que se cargan. Todavía no está definido con el cliente: Blerp admite las dos opciones. En los dos
          casos se usa el valor vigente el día de las horas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Choice<LaborValuation>
          name="Costo real de las horas"
          value={value}
          columns={1}
          onChange={async (v) => {
            const r = await updateCostSettings({ laborValuation: v });
            setError(r.ok ? "" : r.error);
          }}
          options={[
            { value: "operator", label: "Con el costo por hora de cada operario (como hasta ahora)" },
            { value: "general", label: "Con la tarifa general de Mano de obra" },
          ]}
        />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** Precios de catálogo de los materiales, con vigencia. Solo cambian las cotizaciones nuevas. */
function MaterialPricesCard() {
  const history = useAppStore((s) => s.priceHistory);
  const setMaterialPrices = useConfirmedAction("setMaterialPrices");
  const today = todayISO();
  const current = (id: string) => catalogPriceAt(history, id, today);
  const [values, setValues] = useState<Record<string, string>>({});
  const [validFrom, setValidFrom] = useState(today);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = MATERIAL_CATALOG.filter((m) => values[m.id] !== undefined && parseDecimal(values[m.id]) !== current(m.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Precios de materiales
          <HelpTip label="Precios de materiales">
            Es el precio de catálogo con el que arranca cada material en el Cotizador. Cambiarlo solo afecta las cotizaciones nuevas: lo ya cotizado y lo
            comprado guardan su propio precio (lo que se pagó).
          </HelpTip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await setMaterialPrices(
              changed.map((m) => ({ materialId: m.id, value: parseDecimal(values[m.id]), previousValue: current(m.id) })),
              validFrom,
            );
            if (!r.ok) return setMsg({ ok: false, text: r.error });
            setValues({});
            setMsg({ ok: true, text: "Precios guardados." });
          }}
        >
          <ul className="divide-y divide-slate-100">
            {MATERIAL_CATALOG.map((m) => (
              <li key={m.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_10rem] sm:items-start">
                <div className="min-w-0">
                  <label htmlFor={`mat-${m.id}`} className="text-sm font-medium text-slate-800">
                    {m.name} <span className="font-normal text-slate-500">(por {m.unit})</span>
                  </label>
                  <PriceHistoryList kind="material_price" subjectId={m.id} label={m.name} />
                </div>
                <Input
                  id={`mat-${m.id}`}
                  inputMode="decimal"
                  value={values[m.id] ?? asText(current(m.id))}
                  onChange={(e) => setValues({ ...values, [m.id]: e.target.value })}
                />
              </li>
            ))}
          </ul>
          <div className="max-w-xs">
            <Field label="Vigente desde" htmlFor="materials-valid-from" hint="Por defecto, hoy.">
              <Input id="materials-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <Button type="submit" disabled={changed.length === 0}>Guardar precios</Button>
            {changed.length > 0 && <p role="status" className="text-sm text-amber-800">Hay cambios sin guardar.</p>}
            {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-red-600"}>{msg.text}</p>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Costos ───────────────────────────────────────────────────

function CostsSection() {
  const financialPct = useAppStore((s) => s.costSettings.financialPct);
  const updateCostSettings = useConfirmedAction("updateCostSettings");
  const [value, setValue] = useState(() => asText(financialPct));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const dirty = value !== asText(financialPct);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Costos</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-6"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await updateCostSettings({ financialPct: parseDecimal(value) });
            if (!res.ok) return setError(res.error);
            setError("");
            setSaved(true);
          }}
        >
          <div className="flex max-w-sm flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <label htmlFor="financial-pct" className="text-sm font-medium text-slate-700">Gasto financiero (% del precio de venta)</label>
              <HelpTip label="Gasto financiero">
                Es un costo: aparece como línea &quot;Gasto financiero&quot; en el costo presupuestado. Es el valor con el que arranca cada cotización; en el Cotizador
                se puede cambiar. El {DEFAULT_FINANCIAL_PCT}% inicial es un valor de ejemplo, a confirmar.
              </HelpTip>
            </div>
            <Input id="financial-pct" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
          </div>
          <SectionActions onRestore={() => setValue(asText(DEFAULT_FINANCIAL_PCT))} dirty={dirty} saved={saved} error={error} />
        </form>
      </CardContent>
    </Card>
  );
}

// ── Datos ────────────────────────────────────────────────────

function DataSection() {
  const isDemo = useAppStore((s) => s.isDemo);
  const resetDemo = useAppStore((s) => s.resetDemo);
  const clearData = useAppStore((s) => s.clearData);
  const organizationName = useAppStore((s) => s.organizationName);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const confirmWord = organizationName.trim() || "VACIAR";
  const canClear = confirmText.trim().toLowerCase() === confirmWord.toLowerCase();

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="text-red-800">Zona de riesgo</CardTitle>
        <CardDescription>Estas acciones reemplazan o borran los datos de tu empresa y no se pueden deshacer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isDemo && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Restaurar datos demo</h3>
            <p className="mb-3 mt-0.5 text-sm text-slate-500">Vuelve a cargar los proyectos de ejemplo de {COMPANY_NAME}. Se pierden los registros cargados.</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("¿Restaurar los datos demo? Se perderán los registros cargados.")) return;
                setBusy(true);
                const res = await resetDemo();
                setBusy(false);
                setDone(res.ok ? "Datos demo restaurados." : "");
              }}
            >
              Restaurar datos demo
            </Button>
          </div>
        )}

        <div className={isDemo ? "border-t border-slate-200 pt-6" : undefined}>
          <h3 className="text-sm font-semibold text-slate-900">Vaciar todos los datos</h3>
          <p className="mb-3 mt-0.5 text-sm text-slate-500">Borra todos los proyectos, registros y sobrantes para empezar con tus proyectos reales.</p>
          <Field label={`Para confirmar, escribí: ${confirmWord}`} htmlFor="confirm-clear">
            <Input id="confirm-clear" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
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
                setConfirmText("");
                setDone("Datos vaciados.");
              }
            }}
          >
            Vaciar datos
          </Button>
        </div>
        {done && <p role="status" className="text-sm text-emerald-700">{done}</p>}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const organizationName = useAppStore((s) => s.organizationName);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Configuración" subtitle={`${APP_NAME} · ${APP_SUBTITLE} · ${organizationName}`} />
      <Tabs defaultValue="alerts">
        <TabsList aria-label="Secciones de Configuración">
          <TabsTrigger value="alerts">Alertas</TabsTrigger>
          <TabsTrigger value="rates">Tarifas y horas</TabsTrigger>
          <TabsTrigger value="costs">Costos</TabsTrigger>
          <TabsTrigger value="users">Usuarios</TabsTrigger>
          <TabsTrigger value="data">Datos</TabsTrigger>
        </TabsList>
        <TabsContent value="alerts">
          <AlertsSection />
        </TabsContent>
        <TabsContent value="rates">
          <RatesSection />
        </TabsContent>
        <TabsContent value="costs">
          <CostsSection />
        </TabsContent>
        <TabsContent value="users">
          <UsersSection />
        </TabsContent>
        <TabsContent value="data">
          <DataSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
