// Lote 5A — mapa único de permisos: menú, rutas, datos y acciones de cada rol.
import { describe, expect, it } from "vitest";
import type { AppRole } from "@/types";
import { can, canAccess, canSee, dbRoleOf, homeFor, navFor, ROLE_KEYS, ROLE_LABELS, roleKeyOf, type DataField, type RoleKey } from "@/lib/permissions";
import { effectiveIdentity } from "@/store/use-app-store";

const menu = (r: RoleKey) => navFor(r).map((i) => i.label);

describe("cada rol ve exactamente su menú", () => {
  it("Administrativo: todo, con Horas y Configuración (ahí están Usuarios)", () => {
    expect(menu("admin")).toEqual(["Dashboard", "Proyectos", "Alertas", "Horas", "Cotizador", "Stock", "Operarios", "Configuración"]);
  });
  it("Compras: Dashboard, Proyectos, Alertas, Cotizador, Historial y Stock (Lote 5C, sin ítems Próximamente)", () => {
    expect(menu("compras")).toEqual(["Dashboard", "Proyectos", "Alertas", "Cotizador", "Historial", "Stock"]);
  });
  it("Jefe de planta: Resumen, Proyectos, Operarios, Asignaciones y Alertas", () => {
    expect(menu("jefe_planta")).toEqual(["Resumen", "Proyectos", "Operarios", "Asignaciones", "Alertas"]);
  });
  it("Operario: su día", () => {
    expect(menu("operario")).toEqual(["Mi día"]);
  });
  it("el inicio de cada rol es su primera sección", () => {
    expect(ROLE_KEYS.map(homeFor)).toEqual(["/dashboard", "/compras", "/planta", "/taller"]);
  });
});

describe("guards de ruta", () => {
  const cases: Array<[RoleKey, string, boolean]> = [
    ["admin", "/settings", true],
    ["admin", "/projects/p-1", true],
    ["admin", "/compras", true],
    ["compras", "/compras", true],
    ["compras", "/compras/proyectos", true],
    ["compras", "/compras/stock", true],
    ["compras", "/stock", false], // su Stock está en /compras/stock
    ["compras", "/quotes", false], // el Cotizador completo tiene mano de obra y rentabilidad
    ["compras", "/projects", false],
    ["compras", "/settings", false],
    ["compras", "/history", false],
    ["compras", "/comprasx", false],
    ["jefe_planta", "/planta", true],
    ["jefe_planta", "/operators", false],
    ["jefe_planta", "/dashboard", false],
    ["jefe_planta", "/planta/asignaciones", true],
    ["jefe_planta", "/horas", false],
    ["operario", "/taller/p-1", true],
    ["operario", "/projects", false],
    ["operario", "/settings", false],
  ];
  it.each(cases)("%s en %s → %s", (role, path, ok) => {
    expect(canAccess(role, path)).toBe(ok);
  });
  it("ningún rol que no sea Administrativo entra a Configuración (Usuarios) ni a Operarios", () => {
    for (const r of ["compras", "jefe_planta", "operario"] as const) {
      expect(canAccess(r, "/settings")).toBe(false);
      expect(canAccess(r, "/operators")).toBe(false);
      expect(can(r, "manageUsers")).toBe(false);
    }
    expect(can("admin", "manageUsers")).toBe(true);
  });
});

describe("datos que ve cada rol", () => {
  const visible = (r: RoleKey) => (["salesPrice", "margin", "laborValue", "hourlyCost", "materialCost", "purchasePrice", "hours", "projects"] as DataField[]).filter((f) => canSee(r, f));
  it("Administrativo ve todo", () => {
    expect(visible("admin")).toHaveLength(8);
  });
  it("Compras: costos de materiales y precios de compra; nunca precio de venta, rentabilidad ni mano de obra", () => {
    expect(visible("compras")).toEqual(["materialCost", "purchasePrice", "projects"]);
  });
  it("Jefe de planta y Operario: horas y proyectos, ningún importe", () => {
    expect(visible("jefe_planta")).toEqual(["hours", "projects"]);
    expect(visible("operario")).toEqual(["hours", "projects"]);
  });
});

describe("rol de la base ↔ rol visible", () => {
  it("owner y member son Administrativo; operator es Operario", () => {
    const roles: AppRole[] = ["owner", "member", "compras", "jefe_planta", "operator"];
    expect(roles.map((r) => ROLE_LABELS[roleKeyOf(r)])).toEqual(["Administrativo", "Administrativo", "Compras", "Jefe de planta", "Operario"]);
  });
  it("un usuario nuevo Administrativo se guarda como member (owner queda para quien creó la empresa)", () => {
    expect(ROLE_KEYS.map(dbRoleOf)).toEqual(["member", "compras", "jefe_planta", "operator"]);
  });
});

describe("demo: ver como cada rol, solo en una empresa demo", () => {
  const base = { role: "owner" as AppRole, operators: [], userId: "u", userEmail: "laura@x.com", actingOperatorId: null, userName: "Laura" };
  it("en la demo, un Administrativo mira como Compras o Jefe de planta con su usuario de ejemplo", () => {
    expect(effectiveIdentity({ ...base, isDemo: true, currentMode: "compras" })).toMatchObject({ role: "compras", roleKey: "compras", actor: "Martín Ruiz" });
    expect(effectiveIdentity({ ...base, isDemo: true, currentMode: "jefe_planta" })).toMatchObject({ role: "jefe_planta", actor: "María Ruiz" });
    expect(effectiveIdentity({ ...base, isDemo: true, currentMode: "operario" })).toMatchObject({ role: "operator", roleKey: "operario" });
  });
  it("en una empresa real el selector no cambia nada", () => {
    expect(effectiveIdentity({ ...base, isDemo: false, currentMode: "compras" })).toMatchObject({ role: "owner", roleKey: "admin", actor: "Laura" });
  });
  it("un usuario de Compras real es Compras aunque tenga guardado otro modo", () => {
    expect(effectiveIdentity({ ...base, role: "compras", isDemo: true, currentMode: "admin" })).toMatchObject({ role: "compras", actor: "Laura" });
  });
});
