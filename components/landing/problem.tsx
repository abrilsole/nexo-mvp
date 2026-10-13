import { FileSpreadsheet, MessageCircle, UserRound } from "lucide-react";
import { PROBLEM_POINTS } from "@/lib/landing-content";
import { Container, SectionHeading } from "./primitives";

const ICONS = [FileSpreadsheet, MessageCircle, UserRound];

export function Problem() {
  return (
    <section className="py-20 sm:py-24">
      <Container>
        <SectionHeading
          eyebrow="El problema"
          title="Entre lo que cotizaste y lo que pasó, se pierde la rentabilidad"
          subtitle="Al cotizar estimás, rubro por rubro, materiales, horas de mano de obra, horas de diseño y fletes. En la ejecución pasan cosas distintas, y parte de eso nunca se registra."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {PROBLEM_POINTS.map((p, i) => {
            const Icon = ICONS[i];
            return (
              <div key={p.title} className="rounded-3xl border border-line bg-white p-7 shadow-[0_1px_2px_rgb(11_13_23/0.04)]">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-canvas text-ink ring-1 ring-line">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-6 text-lg font-semibold tracking-tight text-ink">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{p.body}</p>
              </div>
            );
          })}
        </div>
        <p className="mx-auto mt-10 max-w-2xl text-center text-lg font-medium tracking-tight text-pretty text-ink">
          La pregunta no es “¿cuánto stock tengo?”, sino{" "}
          <span className="text-gradient">“¿cuánto terminó costando este proyecto? ¿Estoy ganando lo que pensé?”</span>
        </p>
      </Container>
    </section>
  );
}
