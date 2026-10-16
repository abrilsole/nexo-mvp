// @vitest-environment jsdom
// Lote 5C — pantallas de Compras en la demo: registrar una compra real, estados y ningún dato de venta ni rentabilidad.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSeed } from "@/lib/seed-data";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { todayISO } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/compras",
  useSearchParams: () => new URLSearchParams(),
}));

const { PurchasingProjectsPage } = await import("@/components/purchasing/purchasing-projects");
const { PurchasingDashboard, PurchaseHistoryPage, PurchasingAlertsPage } = await import("@/components/purchasing/purchasing-pages");
const { MaterialsQuotePage } = await import("@/components/purchasing/materials-quote-page");
const { StockPage } = await import("@/components/stock/stock-page");

const seed = buildSeed(new Date());
const FORBIDDEN = /precio de venta|rentabilidad|ganancia|mano de obra \$|margen/i;

beforeEach(() => {
  // Sin empresa cargada no se escribe en la base: todo queda en memoria.
  useAppStore.setState({
    projects: seed.projects,
    operators: seed.operators,
    stock: seed.stock,
    lineStatuses: seed.lineStatuses,
    requests: [],
    settings: { ...DEFAULT_SETTINGS },
    role: "owner",
    isDemo: true,
    currentMode: "compras",
    organizationId: null,
  });
});
afterEach(cleanup);

describe("Compras → Proyectos", () => {
  it("registrar la compra de una línea: queda la compra real con el precio pagado y la línea en Comprado", async () => {
    const user = userEvent.setup();
    const p = seed.projects.find((x) => x.code === "P-1051")!;
    render(<PurchasingProjectsPage projectId={p.id} />);
    // Con ?p= queda elegido solo ese proyecto.
    await user.click(screen.getAllByRole("button", { name: /Registrar compra/ })[0]);
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Proveedor"));
    await user.type(within(dialog).getByLabelText("Proveedor"), "Placas del Plata");
    const price = within(dialog).getByLabelText(/Precio pagado/);
    await user.clear(price);
    await user.type(price, "52000");
    await user.click(within(dialog).getByRole("button", { name: "Registrar compra" }));

    const s = useAppStore.getState();
    const project = s.projects.find((x) => x.id === p.id)!;
    expect(project.purchaseEntries).toHaveLength(1);
    expect(project.purchaseEntries[0]).toMatchObject({ unitCost: 52_000, supplier: "Placas del Plata", date: todayISO(), createdBy: "Martín Ruiz" });
    const line = project.budgetLines.find((l) => l.category === "materials")!;
    expect(s.lineStatuses.find((x) => x.projectId === p.id && x.lineId === line.id)?.status).toBe("purchased");
  });

  it("cambiar a Cotizando; elegir Comprado pide los datos de la compra", async () => {
    const user = userEvent.setup();
    const p = seed.projects.find((x) => x.code === "P-1051")!;
    render(<PurchasingProjectsPage projectId={p.id} />);
    const first = screen.getAllByLabelText(/^Estado de /)[0];
    await user.selectOptions(first, "quoting");
    expect(useAppStore.getState().lineStatuses.some((x) => x.projectId === p.id && x.status === "quoting")).toBe(true);
    await user.selectOptions(screen.getAllByLabelText(/^Estado de /)[0], "purchased");
    expect(screen.getByRole("dialog")).toHaveTextContent("Registrar compra");
  });

  it("vista consolidada: el mismo material de varios proyectos junto", async () => {
    const user = userEvent.setup();
    render(<PurchasingProjectsPage />);
    await user.click(screen.getByRole("radio", { name: "Consolidado" }));
    expect(screen.getByText(/se compra una sola vez y se reparte/)).toBeInTheDocument();
    expect(screen.getAllByText(/P-1051: falta/).length).toBeGreaterThan(0);
  });
});

describe("ninguna pantalla de Compras muestra venta, rentabilidad ni mano de obra", () => {
  it.each([
    ["Dashboard", () => <PurchasingDashboard />],
    ["Proyectos", () => <PurchasingProjectsPage />],
    ["Alertas", () => <PurchasingAlertsPage />],
    ["Cotizador", () => <MaterialsQuotePage />],
    ["Historial", () => <PurchaseHistoryPage />],
  ])("%s", (_name, page) => {
    render(page());
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    expect(screen.queryByText(/Operarios|Horas por operario/)).toBeNull();
  });

  it("Stock: Compras ingresa stock y los links a proyectos van a su lista de materiales", () => {
    render(<StockPage basePath="/compras/stock" />);
    expect(screen.getByRole("button", { name: /Ingresar stock/ })).toBeInTheDocument();
    for (const a of document.querySelectorAll("a[href]")) expect(a.getAttribute("href")).not.toMatch(/^\/projects/);
  });
});
