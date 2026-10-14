// @vitest-environment jsdom
// Lote 4c — la ⓘ se usa con teclado, y el Cotizador y Nuevo proyecto muestran la misma pantalla de cotización.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuoteWorkspaceProps } from "@/components/budget/quote-workspace";
import { HelpTip } from "@/components/ui/help-tip";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => "/" }));

// Registra con qué props se usa la pantalla de cotización compartida.
const workspaceCalls: QuoteWorkspaceProps[] = [];
vi.mock("@/components/budget/quote-workspace", () => ({
  QuoteWorkspace: (props: QuoteWorkspaceProps) => {
    workspaceCalls.push(props);
    return <div data-testid="quote-workspace">{props.actionLabel}</div>;
  },
}));

const { QuotePage } = await import("@/components/quotes/quote-page");
const { NewProjectWizard } = await import("@/components/projects/new-project-wizard");

afterEach(() => {
  cleanup();
  workspaceCalls.length = 0;
});

describe("ⓘ de ayuda accesible", () => {
  it("se abre con Enter o Espacio y se cierra con Escape, devolviendo el foco al botón", async () => {
    const user = userEvent.setup();
    render(
      <p>
        Jornada <HelpTip label="Jornada del operario">Horas por día de cada operario.</HelpTip>
      </p>,
    );
    const button = screen.getByRole("button", { name: "Ayuda: Jornada del operario" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Horas por día de cada operario.")).toBeNull();

    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note", { name: "Jornada del operario" })).toHaveTextContent("Horas por día de cada operario.");

    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("note")).toBeNull();
    expect(button).toHaveFocus();

    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("se cierra con su botón Cerrar o tocando afuera (celular)", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <span>afuera</span>
        <HelpTip label="Plazo">Días hábiles.</HelpTip>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Ayuda: Plazo" }));
    await user.click(screen.getByRole("button", { name: "Cerrar ayuda" }));
    expect(screen.queryByRole("note")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ayuda: Plazo" }));
    await user.click(screen.getByText("afuera"));
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("Cotizador y Nuevo proyecto: la misma pantalla", () => {
  it("el Cotizador usa la pantalla compartida con su botón final y el tipo de proyecto elegible", () => {
    render(<QuotePage />);
    expect(screen.getByTestId("quote-workspace")).toHaveTextContent("Crear proyecto con esta cotización");
    const props = workspaceCalls.at(-1)!;
    expect(props.projectType.onChange).toBeTypeOf("function");
    // Arriba ya no se pregunta tipo de proyecto ni fechas.
    expect(screen.queryByLabelText(/Tipo de proyecto/)).toBeNull();
    expect(screen.queryByLabelText(/Fecha/)).toBeNull();
  });

  it("Nuevo proyecto usa la misma pantalla en el paso de costo, con el tipo del paso 1 fijo", async () => {
    const user = userEvent.setup();
    render(<NewProjectWizard />);
    expect(screen.queryByTestId("quote-workspace")).toBeNull();
    await user.type(screen.getByLabelText("Nombre"), "Local Centro");
    await user.type(screen.getByLabelText("Cliente"), "Retail Sur");
    await user.type(screen.getByLabelText("Responsable"), "Laura");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByTestId("quote-workspace")).toHaveTextContent("Continuar");
    const props = workspaceCalls.at(-1)!;
    expect(props.projectType.onChange).toBeUndefined();
    expect(props.projectType.value).toBe("Local comercial");
    // Con fechas del proyecto, se propone el plazo en días hábiles (editable).
    expect(Number(props.state.deadlineDays)).toBeGreaterThan(0);
  });
});
