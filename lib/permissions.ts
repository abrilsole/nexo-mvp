// ─────────────────────────────────────────────────────────────
// Roles y permisos — UN solo mapa, funciones puras.
// De acá salen el menú lateral, los guards de ruta y lo que cada rol puede ver o hacer.
// La seguridad real está en la base (RLS y funciones por rol): este mapa es el mismo
// criterio, aplicado a la pantalla. Ver docs/ROLES_Y_PERMISOS.md.
// ─────────────────────────────────────────────────────────────
import type { AppRole } from "@/types";

/** Los cuatro roles que ve la gente. Administrativo = owner/member en la base (ver docs/ROLES_Y_PERMISOS.md). */
export type RoleKey = "admin" | "compras" | "jefe_planta" | "operario";

export const ROLE_KEYS: RoleKey[] = ["admin", "compras", "jefe_planta", "operario"];

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Administrativo",
  compras: "Compras",
  jefe_planta: "Jefe de planta",
  operario: "Operario",
};

export function roleKeyOf(role: AppRole): RoleKey {
  if (role === "owner" || role === "member") return "admin";
  if (role === "operator") return "operario";
  return role;
}

/** Valor que se guarda en la base para un rol nuevo (owner queda solo para quien creó la empresa). */
export function dbRoleOf(role: RoleKey): Exclude<AppRole, "owner"> {
  if (role === "admin") return "member";
  if (role === "operario") return "operator";
  return role;
}

/** Ícono del ítem de menú (el componente lo traduce a un ícono real; acá no hay React). */
export type NavIcon = "dashboard" | "projects" | "alerts" | "quotes" | "history" | "stock" | "operators" | "settings" | "materials" | "hours" | "assign" | "day";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

/** Solo lo que está hecho: no hay ítems "Próximamente" (Lote 5B). */
const NAV: Record<RoleKey, NavItem[]> = {
  admin: [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/projects", label: "Proyectos", icon: "projects" },
    { href: "/alerts", label: "Alertas", icon: "alerts" },
    { href: "/horas", label: "Horas", icon: "hours" },
    { href: "/quotes", label: "Cotizador", icon: "quotes" },
    { href: "/history", label: "Historial", icon: "history" },
    { href: "/stock", label: "Stock", icon: "stock" },
    { href: "/operators", label: "Operarios", icon: "operators" },
    { href: "/settings", label: "Configuración", icon: "settings" },
  ],
  compras: [{ href: "/compras", label: "Materiales por proyecto", icon: "materials" }],
  jefe_planta: [
    { href: "/planta", label: "Resumen", icon: "dashboard" },
    { href: "/planta/proyectos", label: "Proyectos", icon: "projects" },
    { href: "/planta/operarios", label: "Operarios", icon: "operators" },
    { href: "/planta/asignaciones", label: "Asignaciones", icon: "assign" },
    { href: "/planta/alertas", label: "Alertas", icon: "alerts" },
  ],
  operario: [{ href: "/taller", label: "Mi día", icon: "day" }],
};

export function navFor(role: RoleKey): NavItem[] {
  return NAV[role];
}

/** Pantalla de inicio de cada rol. */
export function homeFor(role: RoleKey): string {
  return NAV[role][0].href;
}

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * ¿Puede entrar a esta ruta? Administrativo entra a todo. El resto, solo a sus secciones (y lo que cuelga de
 * ellas: el detalle de un proyecto del Operario en /taller/…). "/planta" no habilita "/planta/x" por sí sola:
 * cada sección del Jefe de planta está en el menú.
 */
export function canAccess(role: RoleKey, pathname: string): boolean {
  if (role === "admin") return true;
  return NAV[role].some((i) => under(pathname, i.href));
}

/** Datos económicos: qué rol puede ver cada uno (es la misma matriz que aplica la base). */
export type DataField = "salesPrice" | "margin" | "laborValue" | "hourlyCost" | "materialCost" | "purchasePrice" | "hours" | "projects";

const DATA: Record<RoleKey, Record<DataField, boolean>> = {
  admin: { salesPrice: true, margin: true, laborValue: true, hourlyCost: true, materialCost: true, purchasePrice: true, hours: true, projects: true },
  compras: { salesPrice: false, margin: false, laborValue: false, hourlyCost: false, materialCost: true, purchasePrice: true, hours: false, projects: true },
  jefe_planta: { salesPrice: false, margin: false, laborValue: false, hourlyCost: false, materialCost: false, purchasePrice: false, hours: true, projects: true },
  operario: { salesPrice: false, margin: false, laborValue: false, hourlyCost: false, materialCost: false, purchasePrice: false, hours: true, projects: true },
};

export function canSee(role: RoleKey, field: DataField): boolean {
  return DATA[role][field];
}

export type Action = "manageUsers" | "manageSettings" | "editProjects" | "correctFrozenValues" | "logOwnHours";

const ACTIONS: Record<RoleKey, Action[]> = {
  admin: ["manageUsers", "manageSettings", "editProjects", "correctFrozenValues"],
  compras: [],
  jefe_planta: [],
  operario: ["logOwnHours"],
};

export function can(role: RoleKey, action: Action): boolean {
  return ACTIONS[role].includes(action);
}
