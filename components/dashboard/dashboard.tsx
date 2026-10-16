"use client";
// Dashboard del Administrativo (Lote 6): primer pantallazo en 4 bloques. Cada número se abre y muestra la lista que
// lo explica (proyectos, operarios, rubros), con link al detalle. Nunca se mezclan los tres márgenes.
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { MARGIN_TOOLTIP } from "@/lib/constants";
import { marginSummary, projectSignals, weekHours, type ProjectSignal } from "@/lib/dashboard";
import { formatCurrency, formatDate, formatMarginPoints, formatNumber, formatPercent } from "@/lib/formatting";
import { pendingAssignments } from "@/lib/plant";
import { needsToBuy } from "@/lib/purchasing";
import { rubroLabel } from "@/lib/rubros";
import { SCHEDULE_LABELS, type ScheduleSignal } from "@/lib/production";
import { useAppStore } from "@/store/use-app-store";
import { useAlerts, useMaterialNeeds, useToday } from "@/store/selectors";
import { PageHeader } from "@/components/shared/page-header";
import { ScheduleBadge } from "@/components/shared/badges";
import { HelpTip } from "@/components/ui/help-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 13) return "Buen día";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

type Tone = "green" | "yellow" | "red" | "default";
const TONE: Record<Tone, string> = { green: "text-emerald-700", yellow: "text-amber-700", red: "text-red-700", default: "text-slate-900" };

/** Un número que se abre: muestra la lista que lo explica. */
function Metric({ id, label, value, tone = "default", open, onToggle }: { id: string; label: string; value: string; tone?: Tone; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`detail-${id}`}
      className={cn(
        "flex min-w-0 flex-col items-start rounded-lg border px-3 py-2 text-left hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-blue-600",
        open ? "border-blue-400 bg-blue-50/50" : "border-slate-200 bg-white",
      )}
    >
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className={cn("flex items-center gap-1 text-2xl font-semibold tabular", TONE[tone])}>
        {value} <ChevronDown className={cn("size-4 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
      </span>
    </button>
  );
}

function Detail({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  if (!open) return null;
  return (
    <div id={`detail-${id}`} className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm">
      {children}
    </div>
  );
}

function Block({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          {title} <HelpTip label={title}>{help}</HelpTip>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Dashboard() {
  const today = useToday();
  const projects = useAppStore((s) => s.projects);
  const assignments = useAppStore((s) => s.assignments);
  const operators = useAppStore((s) => s.operators);
  const settings = useAppStore((s) => s.settings);
  const alerts = useAlerts();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen(open === id ? null : id);

  const signals = useMemo(() => projectSignals(projects, today, settings.dueSoonDays), [projects, today, settings.dueSoonDays]);
  const week = useMemo(() => weekHours(projects, assignments, operators, today), [projects, assignments, operators, today]);
  const margin = useMemo(() => marginSummary(projects), [projects]);
  const toBuy = needsToBuy(useMaterialNeeds());
  const unassigned = useMemo(() => pendingAssignments(projects, assignments, today), [projects, assignments, today]);
  const over = week.operators.filter((o) => o.verdict === "over");
  const short = week.operators.filter((o) => o.verdict === "short");
  const delta = margin.expected !== null && margin.projected !== null ? margin.projected - margin.expected : null;

  const projectList = (rows: ProjectSignal[]) =>
    rows.length === 0 ? (
      <p className="text-slate-500">Ninguno.</p>
    ) : (
      <ul className="divide-y divide-slate-200">
        {rows.map(({ project: p, schedule }) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span className="min-w-0 break-words">
              <Link href={`/projects/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.code}</Link> {p.name}
              <span className="block text-xs text-slate-500">entrega {formatDate(p.dueDate)} · {schedule.reason}</span>
            </span>
            <ScheduleBadge view={schedule} />
          </li>
        ))}
      </ul>
    );

  const signalTone: Record<ScheduleSignal, Tone> = { on_time: "green", at_risk: "yellow", late: "red" };

  return (
    <div className="space-y-6">
      <PageHeader title={greeting()} subtitle={`Así están tus proyectos hoy, ${formatDate(today)}. Tocá cada número para ver de dónde sale.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Block
          title="Proyectos"
          help="Semáforo por fecha de entrega y avance (unidades terminadas de cada producto). Atrasado: venció la entrega sin terminar. En riesgo: el avance va más de 20 puntos detrás del tiempo transcurrido o faltan pocos días (Configuración → Alertas). Supuesto a validar con el cliente."
        >
          <div className="grid grid-cols-3 gap-2">
            {(["on_time", "at_risk", "late"] as const).map((k) => (
              <Metric key={k} id={`p-${k}`} label={SCHEDULE_LABELS[k]} value={String(signals[k].length)} tone={signals[k].length ? signalTone[k] : "default"} open={open === `p-${k}`} onToggle={() => toggle(`p-${k}`)} />
            ))}
          </div>
          {(["on_time", "at_risk", "late"] as const).map((k) => (
            <Detail key={k} id={`p-${k}`} open={open === `p-${k}`}>{projectList(signals[k])}</Detail>
          ))}
        </Block>

        <Block
          title="Horas y operarios"
          help="Semana actual, de lunes a hoy: horas previstas en las asignaciones contra las horas que cada operario cargó en ellas. Las de hoy cuentan cuando ya se cargaron."
        >
          <div className="grid grid-cols-3 gap-2">
            <Metric id="h-c" label="Cumplimiento" value={week.compliance === null ? "—" : `${formatNumber(week.compliance, 0)} %`} open={open === "h-c"} onToggle={() => toggle("h-c")} />
            <Metric id="h-o" label="Se pasaron" value={String(over.length)} tone={over.length ? "red" : "default"} open={open === "h-o"} onToggle={() => toggle("h-o")} />
            <Metric id="h-s" label="Quedaron cortos" value={String(short.length)} tone={short.length ? "yellow" : "default"} open={open === "h-s"} onToggle={() => toggle("h-s")} />
          </div>
          {(
            [
              ["h-c", week.operators],
              ["h-o", over],
              ["h-s", short],
            ] as const
          ).map(([id, rows]) => (
            <Detail key={id} id={id} open={open === id}>
              <p className="mb-1 text-xs text-slate-500">
                Del {formatDate(week.from)} al {formatDate(week.to)}: {formatNumber(week.actual)} h cargadas de {formatNumber(week.planned)} h previstas.
              </p>
              {rows.length === 0 ? (
                <p className="text-slate-500">Nadie.</p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {rows.map((o) => (
                    <li key={o.operatorId} className="flex justify-between gap-2 py-1.5">
                      <span>{o.name}</span>
                      <span className={cn("tabular", o.diff > 0 ? "text-red-700" : o.diff < 0 ? "text-amber-700" : "text-emerald-700")}>
                        {formatNumber(o.actual)} de {formatNumber(o.planned)} h {o.diff !== 0 && `(${o.diff > 0 ? "+" : ""}${formatNumber(o.diff)} h)`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/horas" className="mt-2 inline-flex items-center gap-1 text-blue-700 hover:underline">Ver Horas por operario, producto y rubro <ArrowRight className="size-3.5" /></Link>
            </Detail>
          ))}
        </Block>

        <Block
          title="Margen"
          help={`Proyectos en curso: rentabilidad esperada (presupuesto) contra proyectada (lo gastado + lo que falta), ponderadas por precio de venta. La real se muestra aparte y solo para proyectos cerrados. ${MARGIN_TOOLTIP}`}
        >
          <div className="grid grid-cols-3 gap-2">
            <Metric id="m-e" label="Esperado (en curso)" value={formatPercent(margin.expected)} open={open === "m-e"} onToggle={() => toggle("m-e")} />
            <Metric
              id="m-p"
              label="Proyectado (en curso)"
              value={formatPercent(margin.projected)}
              tone={delta !== null && delta < -2 ? "yellow" : "default"}
              open={open === "m-p"}
              onToggle={() => toggle("m-p")}
            />
            <Metric id="m-r" label="Rubro que más falla" value={margin.rubros[0] ? rubroLabel(margin.rubros[0].rubro ?? undefined) : "Ninguno"} tone={margin.rubros[0] ? "red" : "default"} open={open === "m-r"} onToggle={() => toggle("m-r")} />
          </div>
          {delta !== null && <p className="mt-2 text-xs text-slate-500">Proyectado {formatMarginPoints(delta, { signed: true })} contra el esperado.</p>}
          {(["m-e", "m-p"] as const).map((id) => (
            <Detail key={id} id={id} open={open === id}>
              <ul className="divide-y divide-slate-200">
                {margin.rows.map((r) => (
                  <li key={r.project.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <Link href={`/projects/${r.project.id}`} className="text-blue-700 hover:underline">{r.project.code} {r.project.name}</Link>
                    <span className="tabular">esperado {formatPercent(r.expected)} → proyectado {formatPercent(r.projected)}</span>
                  </li>
                ))}
              </ul>
            </Detail>
          ))}
          <Detail id="m-r" open={open === "m-r"}>
            {margin.rubros.length === 0 ? (
              <p className="text-slate-500">Ningún rubro gastó más de lo presupuestado todavía.</p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {margin.rubros.map((r) => (
                  <li key={r.rubro ?? "otros"} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <span>{rubroLabel(r.rubro ?? undefined)}</span>
                    <span className="tabular text-red-700">+{formatCurrency(r.over)} <span className="text-slate-500">(real {formatCurrency(r.actual)} de {formatCurrency(r.budget)})</span></span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-500">
              Real = materiales consumidos (consumo + desperdicio) + horas cargadas + costos del rubro, en los proyectos en curso. El detalle por registro está en
              cada proyecto.
              {margin.withoutRubro > 0 && ` Además hay ${formatCurrency(margin.withoutRubro)} de costos sin rubro (tercerizados, instalación) que no se comparan acá.`}
            </p>
          </Detail>
          {margin.closed.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
              <p className="mb-1 text-xs font-medium text-slate-500">Rentabilidad real (solo proyectos cerrados)</p>
              <ul className="space-y-0.5">
                {margin.closed.slice(0, 4).map((c) => (
                  <li key={c.project.id} className="flex justify-between gap-2">
                    <Link href={`/projects/${c.project.id}`} className="text-blue-700 hover:underline">{c.project.code} {c.project.name}</Link>
                    <span className="tabular">{formatPercent(c.real)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Block>

        <Block title="Pendientes" help="Lo que hay que resolver: alertas abiertas, materiales que faltan pedir y producto + rubro con menos operarios asignados de los pedidos.">
          <div className="grid grid-cols-3 gap-2">
            <Metric id="q-a" label="Alertas abiertas" value={String(alerts.count)} tone={alerts.count ? "red" : "default"} open={open === "q-a"} onToggle={() => toggle("q-a")} />
            <Metric id="q-c" label="Compras sin hacer" value={String(toBuy.length)} tone={toBuy.length ? "yellow" : "default"} open={open === "q-c"} onToggle={() => toggle("q-c")} />
            <Metric id="q-u" label="Asignaciones sin cubrir" value={String(unassigned.length)} tone={unassigned.length ? "yellow" : "default"} open={open === "q-u"} onToggle={() => toggle("q-u")} />
          </div>
          <Detail id="q-a" open={open === "q-a"}>
            <ul className="divide-y divide-slate-200">
              {alerts.open.slice(0, 8).map((a) => (
                <li key={a.id} className="py-1.5">
                  <span className="text-xs text-slate-500">{a.projectCode}</span> {a.title}
                </li>
              ))}
            </ul>
            <Link href="/alerts" className="mt-2 inline-flex items-center gap-1 text-blue-700 hover:underline">Ver todas las alertas <ArrowRight className="size-3.5" /></Link>
          </Detail>
          <Detail id="q-c" open={open === "q-c"}>
            <ul className="divide-y divide-slate-200">
              {toBuy.slice(0, 8).map((l) => (
                <li key={`${l.projectId}-${l.lineId}`} className="py-1.5">
                  <span className="text-xs text-slate-500">{l.projectCode}</span> {l.description} · falta pedir {formatNumber(l.toBuy)} {l.unit}
                </li>
              ))}
            </ul>
            <Link href="/compras/proyectos" className="mt-2 inline-flex items-center gap-1 text-blue-700 hover:underline">Ver necesidades de compra <ArrowRight className="size-3.5" /></Link>
          </Detail>
          <Detail id="q-u" open={open === "q-u"}>
            <ul className="divide-y divide-slate-200">
              {unassigned.map((r) => (
                <li key={`${r.projectId}-${r.itemId}-${r.rubro}`} className="py-1.5">
                  <span className="text-xs text-slate-500">{r.projectCode}</span> {r.itemName} · {rubroLabel(r.rubro)}: {r.assigned} de {r.workers} operarios
                </li>
              ))}
            </ul>
            <Link href="/planta/asignaciones" className="mt-2 inline-flex items-center gap-1 text-blue-700 hover:underline">Ir a Asignaciones <ArrowRight className="size-3.5" /></Link>
          </Detail>
        </Block>
      </div>
    </div>
  );
}
