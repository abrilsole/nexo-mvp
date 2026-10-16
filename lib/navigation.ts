// ─────────────────────────────────────────────────────────────
// Navegación — funciones puras: niveles del breadcrumb y a dónde vuelve "Volver".
// ─────────────────────────────────────────────────────────────

export interface Crumb {
  label: string;
  /** Sin href = nivel actual (no es link). */
  href?: string;
}

/** Secciones de primer nivel: ruta → nombre visible. */
export const SECTION_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  projects: "Proyectos",
  alerts: "Alertas",
  quotes: "Cotizador",
  history: "Historial",
  stock: "Stock",
  operators: "Operarios",
  settings: "Configuración",
  materials: "Materiales",
  compras: "Compras",
  "compras/proyectos": "Proyectos",
  "compras/alertas": "Alertas",
  "compras/cotizador": "Cotizador",
  "compras/historial": "Historial",
  "compras/stock": "Stock",
  planta: "Planta",
  "planta/proyectos": "Proyectos",
  "planta/operarios": "Operarios",
  "planta/asignaciones": "Asignaciones",
  "planta/alertas": "Alertas",
  horas: "Horas",
  taller: "Mi día",
};

/**
 * Breadcrumb a partir de la ruta: cada nivel es un link salvo el último.
 *   /projects/p-1053 → Proyectos (link a /projects) / P-1053
 */
export function breadcrumbTrail(pathname: string, projectCode: (id: string) => string | undefined): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return [];
  const crumbs: Crumb[] = [{ label: SECTION_LABELS[parts[0]] ?? parts[0], href: `/${parts[0]}` }];
  // Secciones de Compras y Jefe de planta: /compras/stock → Compras / Stock.
  const sub = parts[1] ? SECTION_LABELS[`${parts[0]}/${parts[1]}`] : undefined;
  if (sub) crumbs.push({ label: sub, href: `/${parts[0]}/${parts[1]}` });
  if (parts[0] === "projects" && parts[1]) {
    crumbs.push({
      label: parts[1] === "new" ? "Nuevo proyecto" : (projectCode(parts[1]) ?? "Proyecto"),
      href: `/projects/${parts[1]}`,
    });
  }
  const last = crumbs[crumbs.length - 1];
  crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}

/**
 * Lista padre a la que vuelve "Volver" cuando no hay historial dentro de la app.
 *   /projects/x → /projects · /stock?material=x → /stock · /operators?op=x → /operators · secciones → /dashboard
 */
export function parentHref(pathname: string, search = ""): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2) return `/${parts[0]}`;
  if (parts.length === 1 && search.replace(/^\?/, "").length > 0) return `/${parts[0]}`;
  return "/dashboard";
}
