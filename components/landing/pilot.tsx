import { APP_NAME } from "@/lib/constants";
import { ArrowRight, Check } from "lucide-react";
import { DEMO_HREF, PILOT_ASKS, PILOT_CONTACT_HREF, PILOT_GIVES } from "@/lib/landing-content";
import { Container, CtaLink, SectionHeading } from "./primitives";

function List({ items, dark }: { items: string[]; dark?: boolean }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((t) => (
        <li key={t} className={`flex items-start gap-3 text-[15px] ${dark ? "text-white/75" : "text-ink-soft"}`}>
          <Check className={`mt-0.5 size-4 shrink-0 ${dark ? "text-[#a5acff]" : "text-accent"}`} strokeWidth={2.5} aria-hidden />
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Ocupa el lugar de "pricing": todavía no investigamos la disposición a pagar. */
export function Pilot() {
  return (
    <section id="piloto" className="scroll-mt-24 py-20 sm:py-24">
      <Container>
        <SectionHeading
          eyebrow="Piloto"
          title="Probalo con tus proyectos reales"
          subtitle={`Buscamos PyMEs argentinas que fabriquen por proyecto para validar si ${APP_NAME} resuelve un problema real.`}
        />
        <div className="mx-auto mt-14 grid max-w-4xl gap-4 md:grid-cols-2">
          <div className="flex flex-col rounded-3xl border border-line bg-white p-8 shadow-[0_1px_2px_rgb(11_13_23/0.04)]">
            <div className="text-sm font-semibold text-ink">Demo</div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-[-0.04em] text-ink">Abierta</span>
            </div>
            <p className="mt-2 text-sm text-ink-soft">Explorá {APP_NAME} con la empresa ficticia Madera Sur S.R.L.</p>
            <List
              items={[
                "Cuatro roles: Administrativo, Compras, Jefe de planta y Operario",
                "Un proyecto principal con desvío real de materiales",
                "Registro de taller desde el celular",
                "Alertas, sobrantes, cierre e historial",
                "Tus datos quedan guardados en tu cuenta",
                "Vaciá la demo y cargá tus proyectos reales",
              ]}
            />
            <CtaLink href={DEMO_HREF} variant="secondary" className="mt-10 w-full md:mt-auto">
              Abrir la demo
            </CtaLink>
          </div>

          <div className="relative flex flex-col overflow-hidden rounded-3xl bg-ink p-8 text-white shadow-[0_30px_60px_-30px_rgb(39_45_120/0.6)]">
            <div className="landing-glow pointer-events-none absolute inset-0 opacity-70" aria-hidden />
            <div className="relative flex flex-1 flex-col">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Piloto con tu fábrica</div>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80">Tesis ITBA</span>
              </div>
              <div className="mt-4 text-4xl font-semibold tracking-[-0.04em]">Sin costo</div>
              <p className="mt-2 text-sm text-white/60">Es parte de una tesis del ITBA. A cambio, te pedimos feedback.</p>
              <div className="mt-6 text-xs font-semibold tracking-wide text-white/50 uppercase">Qué recibís</div>
              <List items={PILOT_GIVES} dark />
              <div className="mt-6 text-xs font-semibold tracking-wide text-white/50 uppercase">Qué buscamos</div>
              <List items={PILOT_ASKS} dark />
              <CtaLink href={PILOT_CONTACT_HREF} variant="light" className="mt-10 w-full">
                Quiero sumarme <ArrowRight />
              </CtaLink>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
