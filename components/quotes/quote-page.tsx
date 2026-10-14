"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useAppStore } from "@/store/use-app-store";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { QuoteWorkspace } from "@/components/budget/quote-workspace";
import { computeCalculator, initialCalcState, quoteActionBlocker, type CalcState } from "@/components/budget/calculator-state";
import { setQuoteDraft } from "@/components/budget/quote-draft";

/** Cotizador: costo, precio sugerido y rentabilidad ANTES de existir un proyecto. Las fechas reales se cargan al crearlo. */
export function QuotePage() {
  const router = useRouter();
  const projects = useAppStore((s) => s.projects);
  const { overtimeMultiplier, financialPct, hoursPerDay } = useAppStore((s) => s.costSettings);
  const rates = useAppStore((s) => s.hourRates);
  const [state, setState] = useState<CalcState>(() => initialCalcState(financialPct));
  const [projectType, setProjectType] = useState("");
  const [salesPrice, setSalesPrice] = useState(0);

  const calc = useMemo(
    () => computeCalculator(state, projectType, { projects, rates, overtimeMultiplier, hoursPerDay, salesPrice }),
    [state, projectType, projects, rates, overtimeMultiplier, hoursPerDay, salesPrice],
  );

  const toProject = () => {
    if (quoteActionBlocker(calc, salesPrice)) return;
    setQuoteDraft({ state, projectType, salesPrice });
    router.push("/projects/new");
  };

  const reset = () => {
    setState(initialCalcState(financialPct));
    setProjectType("");
    setSalesPrice(0);
  };

  return (
    <div>
      <PageHeader
        back
        title="Cotizador"
        actions={
          <Button variant="outline" onClick={reset}>
            <RotateCcw /> Empezar de nuevo
          </Button>
        }
      />
      <QuoteWorkspace
        state={state}
        onState={setState}
        result={calc}
        projectType={{ value: projectType, onChange: setProjectType }}
        salesPrice={salesPrice}
        onSalesPrice={setSalesPrice}
        actionLabel="Crear proyecto con esta cotización"
        onAction={toProject}
      />
    </div>
  );
}
