// @vitest-environment jsdom
// Compras (Lote 6) — pantallas en la demo: de la necesidad a la orden de compra, factura (costo real) y recepción
// (estado de materiales). Stock solo lectura y ningún dato de venta, rentabilidad ni mano de obra.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSeed } from "@/lib/seed-data";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { todayISO } from "@/lib/formatting";
import { materialCosts, materialNeeds, materialsState } from "@/lib/purchasing";
import { useAppStore } from "@/store/use-app-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/compras",
  useSearchParams: () => new URLSearchParams(),
}));

const { PurchasingProjectsPage } = await import("@/components/purchasing/purchasing-projects");
const { PurchasingDashboard, PurchasingAlertsPage, OrdersPage } = await import("@/components/purchasing/purchasing-pages");
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
    orders: seed.orders,
    requests: [],
    settings: { ...DEFAULT_SETTINGS },
    role: "owner",
    isDemo: true,
    currentMode: "compras",
    organizationId: null,
  });
});
afterEach(cleanup);

describe("de la necesidad a la orden de compra, la factura y la recepción", () => {
  it("P-1051: elegir sus materiales, generar la OC, enviarla, facturarla y recibirla", async () => {
    const user = userEvent.setup();
    const p = seed.projects.find((x) => x.code === "P-1051")!;
    const view = render(<PurchasingProjectsPage projectId={p.id} />);
    const boxes = screen.getAllByRole("checkbox", { name: /de P-1051$/ });
    for (const b of boxes) await user.click(b);
    await user.click(screen.getByRole("button", { name: /Generar orden de compra/ }));
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Proveedor elegido"));
    await user.type(within(dialog).getByLabelText("Proveedor elegido"), "Placas del Plata");
    await user.click(within(dialog).getByRole("button", { name: "Crear orden en Borrador" }));

    let s = useAppStore.getState();
    const oc = s.orders.find((o) => o.number === "OC-0004")!;
    expect(oc).toMatchObject({ supplier: "Placas del Plata", status: "draft", paid: false, received: "no" });
    expect(oc.lines).toHaveLength(boxes.length);
    // Pedido, pero el costo real del proyecto todavía no cambia.
    expect(s.projects.find((x) => x.id === p.id)!.purchaseEntries).toHaveLength(0);
    expect(materialNeeds(s.projects, s.orders, s.stock, todayISO()).filter((n) => n.projectId === p.id).every((n) => n.status !== "to_buy")).toBe(true);
    view.unmount();

    render(<OrdersPage />);
    const card = () => screen.getByRole("region", { name: "Orden OC-0004" });
    await user.click(within(card()).getByRole("button", { name: /Marcar como enviada/ }));
    expect(useAppStore.getState().orders.find((o) => o.id === oc.id)?.status).toBe("sent");

    await user.click(within(card()).getByRole("button", { name: /Registrar factura/ }));
    await user.type(within(screen.getByRole("dialog")).getByLabelText("N° de factura"), "A-0001-00000077");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar factura" }));
    s = useAppStore.getState();
    const invoiced = s.orders.find((o) => o.id === oc.id)!;
    expect(invoiced).toMatchObject({ status: "invoiced", invoiceNumber: "A-0001-00000077", paid: false });
    const project = s.projects.find((x) => x.id === p.id)!;
    expect(project.purchaseEntries).toHaveLength(oc.lines.length);
    expect(project.purchaseEntries[0]).toMatchObject({ supplier: "Placas del Plata", createdBy: "Martín Ruiz" });
    expect(materialCosts(project, s.orders).real).toBeGreaterThan(0);

    await user.click(within(card()).getByRole("button", { name: /Recibir/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar recepción" }));
    s = useAppStore.getState();
    expect(s.orders.find((o) => o.id === oc.id)?.received).toBe("yes");
    const needs = materialNeeds(s.projects, s.orders, s.stock, todayISO());
    // Lo que cubría el stock libre del depósito no se pidió: falta que el Administrativo lo asigne al proyecto.
    const pending = needs.filter((n) => n.projectId === p.id && n.status !== "received");
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((n) => n.fromStock > 0 && n.toBuy === 0)).toBe(true);
    expect(materialsState(needs, p.id)).toBe("on_the_way");
    useAppStore.setState({ role: "owner", currentMode: "admin" });
    for (const n of pending) {
      expect(s.assignStock({ projectId: p.id, materialId: n.materialId!, materialName: n.description, unit: n.unit, quantity: n.fromStock }).ok).toBe(true);
    }
    s = useAppStore.getState();
    expect(materialsState(materialNeeds(s.projects, s.orders, s.stock, todayISO()), p.id)).toBe("complete");
  });
});

describe("ninguna pantalla de Compras muestra venta, rentabilidad ni mano de obra", () => {
  it.each([
    ["Dashboard", () => <PurchasingDashboard />],
    ["Necesidades", () => <PurchasingProjectsPage />],
    ["Órdenes de compra", () => <OrdersPage />],
    ["Alertas", () => <PurchasingAlertsPage />],
    ["Cotizador", () => <MaterialsQuotePage />],
  ])("%s", (_name, page) => {
    render(page());
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    expect(screen.queryByText(/Operarios|Horas por operario/)).toBeNull();
  });

  it("Stock: Compras lo ve en solo lectura y los links a proyectos van a sus necesidades", () => {
    render(<StockPage basePath="/compras/stock" />);
    expect(screen.queryByRole("button", { name: /Ingresar stock/ })).toBeNull();
    expect(screen.getAllByText(/Caño estructural 40×40/).length).toBeGreaterThan(0);
    for (const a of document.querySelectorAll("a[href]")) expect(a.getAttribute("href")).not.toMatch(/^\/projects/);
  });
});
