// @vitest-environment jsdom
// Lote 4d — el panel de resumen y "Si el trabajo se alarga" en pantalla.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DEFAULT_HOUR_RATES } from "@/lib/constants";
import { computeCalculator, initialCalcState, newRubroRow, type CalcState } from "@/components/budget/calculator-state";
import { DelaySection, daysText } from "@/components/budget/delay-section";
import { QuoteWorkspace } from "@/components/budget/quote-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => "/" }));
afterEach(cleanup);

const state: CalcState = {
  ...initialCalcState(5),
  rubros: [
    {
      ...newRubroRow("carpinteria_madera"),
      materials: [{ key: "m", name: "Melamina", unit: "placa", quantity: "1", unitCost: "50000", wastePct: "0" }],
      workers: "1",
      hoursPerWorker: "3",
      designHours: "1",
      adminHours: "2",
    },
  ],
};
const calc = (salesPrice: number) =>
  computeCalculator(state, "", { projects: [], rates: DEFAULT_HOUR_RATES, overtimeMultiplier: 2, hoursPerDay: 9.5, salesPrice, isDemo: false });

describe("panel de resumen", () => {
  it("muestra materiales y mano de obra con costo, rentabilidad y venta, sin IVA", () => {
    const result = calc(0);
    render(
      <QuoteWorkspace state={state} onState={vi.fn()} result={result} projectType={{ value: "" }} salesPrice={0} onSalesPrice={vi.fn()} actionLabel="Continuar" onAction={vi.fn()} />,
    );
    const panel = screen.getByRole("complementary", { name: "Resumen de la cotización" });
    expect(within(panel).getByText("(importes sin IVA)")).toBeInTheDocument();
    const mat = within(panel).getByRole("region", { name: "Materiales" });
    expect(mat).toHaveTextContent("$ 50.000");
    expect(mat).toHaveTextContent("Rentabilidad30,0%");
    const mo = within(panel).getByRole("region", { name: "Mano de obra" });
    expect(mo).toHaveTextContent("$ 138.000");
    expect(mo).toHaveTextContent("Operarios $ 57.000 · Diseño $ 27.000 · Administración $ 54.000");
    expect(panel).toHaveTextContent("Precio sugerido (sin IVA)$ 282.707");
    expect(panel).toHaveTextContent("28,5%");
    expect(panel).not.toHaveTextContent("Transporte");
  });
});

describe("si el trabajo se alarga", () => {
  it("si no soporta ni un día extra lo dice, sin mostrar 0 días", () => {
    render(<DelaySection result={calc(282_707)} state={state} onState={vi.fn()} />);
    expect(screen.getByText(/No soporta ni un día extra: ya queda por debajo del piso/)).toBeInTheDocument();
    expect(screen.queryByText(/0 días/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Si el trabajo se alarga/ })).toBeInTheDocument();
    expect(screen.getByText("+25 % (+1 día hábil)")).toBeInTheDocument();
  });

  it("los días que soporta van con un decimal", () => {
    expect(daysText(0.45)).toBe("0,4 días");
    expect(daysText(1.04)).toBe("1 día");
    expect(daysText(1.17)).toBe("1,1 días");
    expect(daysText(3)).toBe("3 días");
    render(<DelaySection result={calc(600_000)} state={state} onState={vi.fn()} />);
    expect(screen.getByText(/Soporta hasta/)).toHaveTextContent("Soporta hasta 1,1 días extra");
  });
});
