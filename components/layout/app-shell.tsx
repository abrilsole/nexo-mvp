"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Boxes, Calculator, FolderKanban, History, HardHat, LayoutDashboard, LogOut, Menu, Plus, Settings, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_SUBTITLE } from "@/lib/constants";
import { useAppStore } from "@/store/use-app-store";
import { useAlerts } from "@/store/selectors";
import { Button } from "@/components/ui/button";
import { ModeSwitch } from "./mode-switch";
import { WorkshopHome } from "@/components/workshop/workshop-home";
import { GlobalSearch } from "./global-search";
import { useTrackNavigation } from "./back-button";
import { breadcrumbTrail, type Crumb } from "@/lib/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Proyectos", icon: FolderKanban },
  { href: "/alerts", label: "Alertas", icon: TriangleAlert },
  { href: "/quotes", label: "Cotizador", icon: Calculator },
  { href: "/history", label: "Historial", icon: History },
  { href: "/stock", label: "Stock", icon: Boxes },
  { href: "/operators", label: "Operarios", icon: HardHat },
  { href: "/settings", label: "Configuración", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return pathname.startsWith(href);
}

function useBreadcrumb(): Crumb[] {
  const pathname = usePathname();
  const projects = useAppStore((s) => s.projects);
  return breadcrumbTrail(pathname, (id) => projects.find((p) => p.id === id)?.code);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { count } = useAlerts();
  const userName = useAppStore((s) => s.userName);
  const userEmail = useAppStore((s) => s.userEmail);
  const organizationName = useAppStore((s) => s.organizationName);

  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="block shrink-0 px-5 py-5" title="Ir al sitio">
        <div className="text-lg font-semibold tracking-tight text-slate-900">{APP_NAME}</div>
        <div className="text-xs text-slate-500">{APP_SUBTITLE}</div>
      </Link>
      <nav aria-label="Principal" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                active ? "bg-blue-50 text-blue-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
              {item.href === "/alerts" && count > 0 && (
                <span className="ml-auto rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-700 tabular">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="shrink-0 space-y-3 border-t border-slate-200 p-4">
        <ModeSwitch />
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700" aria-hidden>
            {userName.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
          </div>
          <div className="min-w-0">
            <div className="break-words text-sm font-medium text-slate-900">{userName}</div>
            <div className="break-words text-xs text-slate-500" title={userEmail}>
              {organizationName}
            </div>
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-slate-500">
            <LogOut /> Cerrar sesión
          </Button>
        </form>
      </div>
    </div>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const crumbs = useBreadcrumb();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-8">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Abrir menú">
        <Menu />
      </Button>
      <nav aria-label="Breadcrumb" className="hidden min-w-0 text-sm text-slate-500 sm:block">
        {crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="mx-1.5 text-slate-300" aria-hidden>/</span>}
            {c.href ? (
              <Link href={c.href} className="hover:text-blue-700 hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className="font-medium text-slate-900" aria-current="page">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      <GlobalSearch />
      <Button asChild className="hidden sm:inline-flex">
        <Link href="/projects/new">
          <Plus /> Nuevo proyecto
        </Link>
      </Button>
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const mode = useAppStore((s) => s.currentMode);
  const role = useAppStore((s) => s.role);
  const [menuOpen, setMenuOpen] = useState(false);
  useTrackNavigation();

  if (role === "operator" || mode === "workshop") return <WorkshopHome />;

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-slate-200 bg-white lg:block">
        <Sidebar />
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <Button variant="ghost" size="icon" className="absolute right-2 top-3" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú">
              <X />
            </Button>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}
      <div className="min-w-0 lg:pl-60">
        <Header onMenu={() => setMenuOpen(true)} />
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
