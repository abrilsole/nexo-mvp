import { Check, Minus, Plus } from "lucide-react";
import { MANAGEMENT_POINTS, WORKSHOP_POINTS } from "@/lib/landing-content";
import { Container, SectionHeading } from "./primitives";

function Stepper({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2.5 ring-1 ring-line">
      <span className="text-[11px] font-medium text-ink-soft">{label}</span>
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-white ring-1 ring-line">
          <Minus className="size-3" />
        </span>
        <span className="w-8 text-center text-sm font-semibold text-ink tabular">{value}</span>
        <span className="flex size-6 items-center justify-center rounded-md bg-white ring-1 ring-line">
          <Plus className="size-3" />
        </span>
      </div>
    </div>
  );
}

function PhoneMockup() {
  return (
    <div
      className="mx-auto w-[260px] rounded-[44px] bg-ink p-2.5 shadow-[0_40px_80px_-30px_rgb(11_13_23/0.6)]"
      role="img"
      aria-label="Registro de taller en el celular: 2 placas usadas, 0,2 de desperdicio y 0,3 reutilizable."
    >
      <div className="overflow-hidden rounded-[36px] bg-white" aria-hidden>
        <div className="mx-auto mt-2 h-5 w-24 rounded-full bg-ink" />
        <div className="space-y-3 p-4">
          <div>
            <div className="text-[10px] text-ink-faint">P-1042 · Local Palermo</div>
            <div className="text-sm font-semibold tracking-tight text-ink">¿Qué pasó en el taller?</div>
          </div>
          <div className="rounded-xl border border-accent/30 bg-accent-soft px-3 py-2.5">
            <div className="text-[10px] text-ink-faint">Material</div>
            <div className="text-xs font-semibold text-ink">Placa MDF 18 mm</div>
          </div>
          <div className="flex gap-1.5 text-[10px] font-medium">
            <span className="rounded-full bg-ink px-2 py-1 text-white">Comprado</span>
            <span className="rounded-full bg-canvas px-2 py-1 text-ink-soft ring-1 ring-line">Stock</span>
            <span className="rounded-full bg-canvas px-2 py-1 text-ink-soft ring-1 ring-line">Sobrante</span>
          </div>
          <Stepper label="Usé" value="2" />
          <Stepper label="Desperdicio" value="0,2" />
          <Stepper label="Reutilizable" value="0,3" />
          <div className="flex h-10 items-center justify-center rounded-xl bg-ink text-xs font-semibold text-white">Registrar</div>
        </div>
      </div>
    </div>
  );
}

function PointList({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-3 text-[15px] text-ink-soft">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Check className="size-3" strokeWidth={3} aria-hidden />
          </span>
          {t}
        </li>
      ))}
    </ul>
  );
}

export function Modes() {
  return (
    <section id="taller" className="scroll-mt-24 py-20 sm:py-24">
      <Container>
        <SectionHeading
          eyebrow="Dos modos"
          title="Uno registra. El otro decide."
          subtitle="Separar la captura del análisis es lo que hace que el dato llegue."
        />
        <div className="mt-14 grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-3xl border border-line bg-white p-8 shadow-[0_1px_2px_rgb(11_13_23/0.04)] sm:p-10">
            <span className="text-xs font-semibold tracking-wide text-accent uppercase">Modo Taller · mobile</span>
            <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-ink">Registrar el mundo físico en menos de 30 segundos</h3>
            <PointList items={WORKSHOP_POINTS} />
            <div className="relative mt-10 -mb-24">
              <div className="absolute inset-x-0 top-10 mx-auto h-56 w-56 rounded-full bg-accent/20 blur-3xl" aria-hidden />
              <div className="relative">
                <PhoneMockup />
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl bg-ink p-8 text-white sm:p-10">
            <div className="landing-glow pointer-events-none absolute inset-0 opacity-60" aria-hidden />
            <div className="relative">
              <span className="text-xs font-semibold tracking-wide text-[#a5acff] uppercase">Modo Gestión · desktop</span>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">Ver rentabilidad, excepciones y desvíos</h3>
              <ul className="mt-6 space-y-3">
                {MANAGEMENT_POINTS.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[15px] text-white/70">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
                      <Check className="size-3" strokeWidth={3} aria-hidden />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
              <div className="mt-10 space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur" aria-hidden>
                {[
                  { c: "Materiales", b: "$ 4,0 M", r: "$ 4,85 M", d: "+$ 850.000", bad: true },
                  { c: "Mano de obra", b: "$ 600 k", r: "$ 600 k", d: "en línea" },
                  { c: "Transporte y fletes", b: "$ 300 k", r: "$ 350 k", d: "+$ 50.000" },
                ].map((row) => (
                  <div key={row.c} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-xl px-2 py-2 text-xs tabular sm:grid-cols-[1fr_auto_auto_auto]">
                    <span className="font-medium text-white">{row.c}</span>
                    <span className="hidden text-white/50 sm:inline">{row.b}</span>
                    <span className="text-white/80">{row.r}</span>
                    <span className={row.bad ? "font-semibold text-[#ff8a80]" : "text-white/50"}>{row.d}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-white/40">P-1042 · Local Palermo, proyectado. Datos ficticios de la demo.</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
