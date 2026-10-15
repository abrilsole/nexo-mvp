import { APP_NAME } from "@/lib/constants";
import { Bell, FolderKanban, History, LayoutDashboard, Layers, Search, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Mockup ilustrativo del Modo Gestión. Los proyectos y números son los de la demo ficticia. */
const BARS = [
  { code: "P-1042", expected: 40, projected: 30.8 },
  { code: "P-1045", expected: 35, projected: 33 },
  { code: "P-1048", expected: 32, projected: 31 },
  { code: "P-1039", expected: 38, projected: 34 },
  { code: "P-1051", expected: 36, projected: 36 },
];

const SIDE = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: FolderKanban, label: "Proyectos" },
  { icon: TriangleAlert, label: "Alertas" },
  { icon: History, label: "Historial" },
  { icon: Layers, label: "Sobrantes" },
];

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <div className="text-[10px] font-medium text-ink-faint">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-ink tabular">{value}</div>
      <div className={cn("mt-0.5 text-[10px] font-medium", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : "text-ink-faint")}>
        {hint}
      </div>
    </div>
  );
}

export function DashboardMockup({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[22px] bg-gradient-to-b from-white to-white/40 p-1.5 shadow-[0_40px_80px_-30px_rgb(39_45_120/0.35),0_0_0_1px_rgb(11_13_23/0.06)] sm:rounded-[28px] sm:p-2.5",
        className,
      )}
      role="img"
      aria-label={`Vista del Modo Administrativo de ${APP_NAME}: rentabilidad esperada 40%, rentabilidad proyectada 30,8% y alerta de materiales en el proyecto Local Palermo.`}
    >
      <div className="overflow-hidden rounded-2xl border border-line bg-canvas sm:rounded-[20px]" aria-hidden>
        {/* barra superior */}
        <div className="flex h-10 items-center gap-3 border-b border-line bg-white px-4">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="mx-auto hidden h-6 w-64 items-center gap-2 rounded-md bg-canvas px-2 text-[10px] text-ink-faint sm:flex">
            <Search className="size-3" /> Buscar proyecto, cliente o código
          </div>
          <Bell className="ml-auto size-3.5 text-ink-faint sm:ml-0" />
        </div>

        <div className="flex">
          <aside className="hidden w-40 shrink-0 border-r border-line bg-white p-3 md:block">
            <div className="px-2 pb-3 text-xs font-semibold text-ink">
              {APP_NAME}
              <div className="text-[9px] font-normal text-ink-faint">Madera Sur S.R.L.</div>
            </div>
            {SIDE.map((s) => (
              <div
                key={s.label}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium",
                  s.active ? "bg-accent-soft text-accent" : "text-ink-soft",
                )}
              >
                <s.icon className="size-3" />
                {s.label}
              </div>
            ))}
          </aside>

          <div className="min-w-0 flex-1 space-y-3 p-3 sm:p-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10px] text-ink-faint">Buen día, Laura</div>
                <div className="text-sm font-semibold tracking-tight text-ink">¿Estás ganando lo que pensaste?</div>
              </div>
              <span className="hidden rounded-full bg-ink px-2.5 py-1 text-[10px] font-medium text-white sm:inline">+ Nuevo proyecto</span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Rentabilidad esperada" value="40,0%" hint="P-1042 al cotizar" />
              <Kpi label="Rentabilidad proyectada" value="30,8%" hint="−9,2 puntos" tone="bad" />
              <Kpi label="Desvío materiales" value="+$ 850k" hint="sobre presupuesto" tone="bad" />
              <Kpi label="Costo imputable" value="$ 500k" hint="no $ 600k comprados" tone="good" />
            </div>

            <div className="grid gap-2 sm:grid-cols-5">
              <div className="rounded-xl border border-line bg-white p-3 sm:col-span-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-ink">Esperado vs. proyectado</div>
                  <div className="flex gap-2 text-[9px] text-ink-faint">
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-ink/20" /> Esperado
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-accent" /> Proyectado
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex h-28 items-end justify-between gap-2 sm:h-32">
                  {BARS.map((b) => (
                    <div key={b.code} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex h-24 w-full items-end justify-center gap-1 sm:h-28">
                        <div className="w-2.5 rounded-t bg-ink/15 sm:w-3.5" style={{ height: `${b.expected * 2.2}%` }} />
                        <div
                          className={cn("w-2.5 rounded-t sm:w-3.5", b.projected < b.expected - 5 ? "bg-bad" : "bg-accent")}
                          style={{ height: `${b.projected * 2.2}%` }}
                        />
                      </div>
                      <div className="text-[8px] text-ink-faint tabular">{b.code}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-line bg-white p-3 sm:col-span-2">
                <div className="text-[11px] font-semibold text-ink">Necesitan atención</div>
                <div className="mt-2 rounded-lg border border-bad/20 bg-bad/5 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-ink">Local Palermo</div>
                      <div className="text-[9px] text-ink-faint">Retail Sur · P-1042</div>
                    </div>
                    <span className="rounded-full bg-bad/10 px-1.5 py-0.5 text-[9px] font-semibold text-bad">En riesgo</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold tabular">
                    <span className="text-ink-faint line-through decoration-ink-faint/50">40,0%</span>
                    <span className="text-ink-faint">→</span>
                    <span className="text-bad">30,8%</span>
                  </div>
                  <div className="mt-1.5 text-[9px] text-ink-soft">Causa: Materiales +$ 850.000</div>
                </div>
                <div className="mt-2 space-y-1.5">
                  {["Producción sin registros hace 7 días", "Entrega en 5 días, todavía en Compras"].map((t) => (
                    <div key={t} className="flex items-center gap-1.5 text-[9px] text-ink-soft">
                      <span className="size-1.5 shrink-0 rounded-full bg-warn" /> {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
