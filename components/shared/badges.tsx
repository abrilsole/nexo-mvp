import type { AlertLevel, EconomicHealth, ProductionStatus, ProjectStatus } from "@/types";
import { PRODUCTION_STATUS_LABELS, SCHEDULE_LABELS, type ScheduleSignal, type ScheduleView } from "@/lib/production";
import { Badge } from "@/components/ui/badge";
import { ALERT_LEVEL_LABELS, ALERT_TONE, HEALTH_LABELS, HEALTH_TONE, STATUS_LABELS, type Tone } from "@/lib/constants";

const STATUS_TONE: Record<ProjectStatus, Tone> = {
  quotation: "gray",
  approved: "blue",
  purchasing: "blue",
  production: "blue",
  installation: "blue",
  completed: "gray",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function HealthBadge({ health }: { health: EconomicHealth }) {
  const tone = HEALTH_TONE[health];
  const dot = { green: "bg-emerald-500", yellow: "bg-amber-500", red: "bg-red-500", blue: "bg-blue-500", gray: "bg-slate-400" }[tone];
  return (
    <Badge tone={tone}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {HEALTH_LABELS[health]}
    </Badge>
  );
}

export function AlertLevelBadge({ level }: { level: AlertLevel }) {
  return <Badge tone={ALERT_TONE[level]} className="uppercase tracking-wide">{ALERT_LEVEL_LABELS[level]}</Badge>;
}

const PRODUCTION_TONE: Record<ProductionStatus, Tone> = { pending: "gray", in_production: "blue", done: "green" };

/** Estado de un producto o, derivado de sus productos, de la producción del proyecto. */
export function ProductionBadge({ status }: { status: ProductionStatus }) {
  return <Badge tone={PRODUCTION_TONE[status]}>{PRODUCTION_STATUS_LABELS[status]}</Badge>;
}

const SCHEDULE_TONE: Record<ScheduleSignal, Tone> = { on_time: "green", at_risk: "yellow", late: "red" };

/** Semáforo de entrega (fecha y avance). `title` explica de dónde sale. */
export function ScheduleBadge({ view }: { view: ScheduleView }) {
  return (
    <Badge tone={SCHEDULE_TONE[view.signal]} title={view.reason}>
      {SCHEDULE_LABELS[view.signal]}
    </Badge>
  );
}
