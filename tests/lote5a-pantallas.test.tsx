// @vitest-environment jsdom
// Lote 5A — pantallas: menú y guard por rol, demo con 4 roles y tarifas con "vigente desde".
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSeed } from "@/lib/seed-data";
import { DEFAULT_HOUR_RATES } from "@/lib/constants";
import { todayISO } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";

const nav = vi.hoisted(() => ({ pathname: "/dashboard", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: nav.replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { AppShell } = await import("@/components/layout/app-shell");
const { SettingsPage } = await import("@/components/settings/settings-page");

const seed = buildSeed(new Date());

beforeEach(() => {
  // Sin empresa cargada no se escribe en la base (persistRemote no hace nada): todo queda en memoria.
  useAppStore.setState({
    projects: seed.projects,
    operators: seed.operators,
    stock: seed.stock,
    role: "owner",
    isDemo: true,
    currentMode: "admin",
    organizationId: null,
    userName: "Laura Gómez",
    hourRates: DEFAULT_HOUR_RATES.map((r) => ({ ...r })),
    priceHistory: [],
  });
  nav.pathname = "/dashboard";
  nav.replace.mockClear();
});
afterEach(cleanup);

const menuItems = () => {
  const navEl = screen.getAllByRole("navigation", { name: "Principal" })[0];
  return within(navEl)
    .getAllByRole("link")
    .map((el) => el.querySelector("span")?.textContent?.trim()); // solo el nombre (sin el contador de alertas)
};

describe("menú y acceso por rol", () => {
  it("Administrativo ve su menú completo y la demo ofrece los 4 roles", () => {
    render(<AppShell>contenido</AppShell>);
    expect(menuItems()).toEqual(["Dashboard", "Proyectos", "Alertas", "Horas", "Cotizador", "Historial", "Stock", "Operarios", "Configuración"]);
    const group = screen.getAllByRole("radiogroup", { name: "Ver la demo como" })[0];
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Administrativo", "Compras", "Jefe de planta", "Operario"]);
    expect(screen.getByText("contenido")).toBeInTheDocument();
  });

  it("en la demo como Compras: su menú, su usuario de ejemplo, y sin acceso a Proyectos", async () => {
    useAppStore.setState({ currentMode: "compras" });
    nav.pathname = "/projects";
    render(<AppShell>contenido secreto</AppShell>);
    expect(menuItems()).toEqual(["Dashboard", "Proyectos", "Alertas", "Cotizador", "Historial", "Stock"]);
    expect(screen.getAllByText("Martín Ruiz")[0]).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No tenés acceso a esta sección");
    expect(screen.queryByText("contenido secreto")).toBeNull();
    expect(screen.queryByRole("link", { name: /Nuevo proyecto/ })).toBeNull();
  });

  it("Jefe de planta que entra al dashboard va a su inicio", () => {
    useAppStore.setState({ role: "jefe_planta", isDemo: false });
    render(<AppShell>x</AppShell>);
    expect(menuItems()[0]).toBe("Resumen");
    expect(nav.replace).toHaveBeenCalledWith("/planta");
  });

  it("en una empresa real no aparece el selector de la demo", () => {
    useAppStore.setState({ isDemo: false, currentMode: "compras" });
    render(<AppShell>contenido</AppShell>);
    expect(screen.queryByRole("radiogroup", { name: "Ver la demo como" })).toBeNull();
    expect(menuItems()[0]).toBe("Dashboard");
  });

  it("el Operario ve su día, sin menú de gestión", () => {
    useAppStore.setState({ currentMode: "operario" });
    render(<AppShell>contenido</AppShell>);
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
    // Preseleccionado con el primer operario activo (nunca "Elegí un operario…").
    expect(screen.getByLabelText("Demo: ver el día de")).toHaveValue("op-juan");
  });
});

describe("tarifas con vigente desde", () => {
  it("un cambio con fecha futura queda programado: hoy sigue la tarifa actual y se ve en el historial", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole("tab", { name: "Tarifas y horas" }));
    const labor = screen.getByLabelText("Mano de obra");
    await user.clear(labor);
    await user.type(labor, "25000");
    const date = screen.getByLabelText("Vigente desde", { selector: "#rates-valid-from" });
    await user.clear(date);
    await user.type(date, "2999-01-01");
    await user.click(screen.getAllByRole("button", { name: "Guardar" })[0]);

    const s = useAppStore.getState();
    expect(s.hourRates.find((r) => r.id === "labor")?.hourlyRate).toBe(19_000);
    expect(s.priceHistory.filter((r) => r.kind === "hour_rate").map((r) => [r.value, r.validFrom])).toEqual([
      [19_000, "2000-01-01"],
      [25_000, "2999-01-01"],
    ]);
    expect(labor).toHaveValue("19000");
    await user.click(screen.getAllByText(/Ver historial/)[0]);
    expect(screen.getByRole("list", { name: "Historial de Mano de obra" })).toHaveTextContent("programado");
  });

  it("un cambio desde hoy se usa desde hoy", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole("tab", { name: "Tarifas y horas" }));
    const labor = screen.getByLabelText("Mano de obra");
    await user.clear(labor);
    await user.type(labor, "21000");
    expect(screen.getByLabelText("Vigente desde", { selector: "#rates-valid-from" })).toHaveValue(todayISO());
    await user.click(screen.getAllByRole("button", { name: "Guardar" })[0]);
    expect(useAppStore.getState().hourRates.find((r) => r.id === "labor")?.hourlyRate).toBe(21_000);
  });

  it("Configuración tiene la pestaña Usuarios y el costo real de las horas marcado como hipótesis", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    expect(screen.getByRole("tab", { name: "Usuarios" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Tarifas y horas" }));
    expect(screen.getByText("Hipótesis a confirmar con el cliente")).toBeInTheDocument();
  });
});

describe("horas con el costo vigente ese día (store)", () => {
  it("un cambio de costo a mitad de mes no cambia las horas anteriores ni las de antes del cambio", () => {
    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const project = seed.projects.find((p) => p.status === "production" && p.assignedOperatorIds.includes("op-juan"))!;
    const before = project.actualEntries.map((e) => e.amount);
    const s = useAppStore.getState();
    // Juan pasa de 15.000 a 20.000 desde hace 5 días.
    expect(s.updateOperator("op-juan", { name: "Juan Pérez", role: "Carpintería", hourlyCost: 20_000 }, daysAgo(5)).ok).toBe(true);
    expect(useAppStore.getState().operators.find((o) => o.id === "op-juan")?.hourlyCost).toBe(20_000);
    expect(s.logHours(project.id, { operatorId: "op-juan", date: daysAgo(8), hours: 1, workType: "Armado" }).ok).toBe(true);
    expect(s.logHours(project.id, { operatorId: "op-juan", date: daysAgo(2), hours: 1, workType: "Armado" }).ok).toBe(true);
    const after = useAppStore.getState().projects.find((p) => p.id === project.id)!.actualEntries;
    expect(after.slice(0, before.length).map((e) => e.amount)).toEqual(before);
    expect(after.slice(-2).map((e) => [e.amount, e.labor?.hourlyCost])).toEqual([
      [15_000, 15_000],
      [20_000, 20_000],
    ]);
  });
});
