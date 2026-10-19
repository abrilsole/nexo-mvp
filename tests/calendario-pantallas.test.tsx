// @vitest-environment jsdom
// Lote 6 · Fase 3 — calendario del Jefe (grilla operarios × días) y edición de días laborales.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSeed } from "@/lib/seed-data";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { addDays } from "@/lib/plant";
import { todayISO } from "@/lib/formatting";
import { useAppStore } from "@/store/use-app-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/planta/asignaciones",
  useSearchParams: () => new URLSearchParams(),
}));

const { AssignmentsPage } = await import("@/components/plant/assignments-page");
const { PlantOperatorsPage } = await import("@/components/plant/plant-pages");

const seed = buildSeed(new Date());
const today = todayISO();

beforeEach(() => {
  useAppStore.setState({
    projects: seed.projects,
    operators: seed.operators,
    assignments: seed.assignments,
    dayExceptions: seed.dayExceptions,
    stock: seed.stock,
    orders: seed.orders,
    settings: { ...DEFAULT_SETTINGS },
    role: "owner",
    isDemo: true,
    currentMode: "jefe_planta",
    organizationId: null,
  });
});
afterEach(cleanup);

describe("calendario operarios × días", () => {
  it("cada celda: horas/capacidad; gris si no es laborable, rojo si se pasa; chips por proyecto", () => {
    render(<AssignmentsPage />);
    const grid = screen.getByRole("table", { name: "Calendario operarios por día" });
    const cells = within(grid).getAllByRole("group");
    expect(cells).toHaveLength(seed.operators.length * 7);
    // Juan hoy: 8 h del proyecto estrella.
    const juanHoy = cells.find((c) => c.getAttribute("aria-label")?.startsWith(`Juan Pérez, `) && c.getAttribute("aria-label")?.includes("8 de"))!;
    expect(within(juanHoy).getByRole("button", { name: /Editar P-1058 8 h/ })).toBeInTheDocument();
    // El domingo nadie trabaja (gris).
    expect(cells.filter((c) => c.dataset.state === "off").length).toBeGreaterThanOrEqual(seed.operators.length);
    // Diego no viene el día de su excepción y tenía 8 h: rojo (si cae en esta semana).
    const diego = seed.dayExceptions.find((x) => x.operatorId === "op-diego" && !x.works)!;
    const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - ((new Date(`${today}T12:00:00`).getDay() + 6) % 7)));
    if (week.includes(diego.date) && seed.assignments.some(a=>a.operatorId === "op-diego" && a.date === diego.date)) expect(cells.some((c) => c.dataset.state === "over" && c.getAttribute("aria-label")?.startsWith("Diego Sosa"))).toBe(true);
  });
});

describe("días laborales en Operarios", () => {
  it("el Jefe agrega una excepción y la celda cambia", async () => {
    const user = userEvent.setup();
    render(<PlantOperatorsPage />);
    expect(screen.getByText("lunes, martes, miércoles y jueves")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Días laborales de Lucía Ferreyra" }));
    const dialog = screen.getByRole("dialog");
    const date = addDays(today, 30);
    await user.type(within(dialog).getByLabelText("Fecha"), date);
    await user.selectOptions(within(dialog).getByLabelText("Ese día"), "no");
    await user.click(within(dialog).getByRole("button", { name: "Agregar excepción" }));
    expect(useAppStore.getState().dayExceptions.some((x) => x.operatorId === "op-lucia" && x.date === date && !x.works)).toBe(true);
    // Días: agregar el sábado.
    await user.click(within(dialog).getByRole("checkbox", { name: "sábado" }));
    await user.click(within(dialog).getByRole("button", { name: "Guardar días" }));
    expect(useAppStore.getState().operators.find((o) => o.id === "op-lucia")?.workDays).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("Compras no puede editar días (el store lo rechaza)", () => {
    useAppStore.setState({ currentMode: "compras" });
    expect(useAppStore.getState().saveSchedule("op-juan", { workDays: [1] }).ok).toBe(false);
  });
});
