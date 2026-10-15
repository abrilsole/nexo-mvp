import Link from "next/link";
import { APP_NAME, APP_SUBTITLE } from "@/lib/constants";
import { DEMO_HREF, NAV_LINKS } from "@/lib/landing-content";
import { Container, Logo } from "./primitives";

export function Footer() {
  return (
    <footer className="border-t border-line bg-white">
      <Container className="py-12">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-3 text-sm text-ink-soft">
              {APP_SUBTITLE}. Herramienta de investigación y validación de una tesis de la Licenciatura en Gestión de Negocios y
              Tecnología del ITBA.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 text-sm">
            <div>
              <div className="font-semibold text-ink">Sitio</div>
              <ul className="mt-3 space-y-2">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="text-ink-soft hover:text-ink">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-ink">Demo</div>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href={DEMO_HREF} className="text-ink-soft hover:text-ink">
                    Modo Administrativo
                  </Link>
                </li>
                <li>
                  <Link href="/projects" className="text-ink-soft hover:text-ink">
                    Proyectos
                  </Link>
                </li>
                <li>
                  <Link href="/alerts" className="text-ink-soft hover:text-ink">
                    Alertas
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-ink-faint sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} {APP_NAME} · Proyecto de tesis ITBA</span>
          <span>No afirmamos Product-Market Fit. Los números de la demo son ficticios.</span>
        </div>
      </Container>
    </footer>
  );
}
