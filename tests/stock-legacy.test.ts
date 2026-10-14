import { describe, expect, it } from "vitest";
import { buildSeed } from "@/lib/seed-data";
import { projectEconomics } from "@/lib/calculations";
import { leftoverRows, projectHoldings, stockRows } from "@/lib/stock";
import { projectMaterialFlow } from "@/lib/material-flow";
import { deriveLedgerFromLegacy } from "@/lib/stock-legacy";

const NOW = new Date("2026-10-07T12:00:00Z");

describe("migración del modelo anterior al ledger", () => {
  const seed = buildSeed(NOW);

  it("el costo de materiales que sale del ledger coincide con el de los registros de uso", () => {
    for (const p of seed.projects) {
      const fromLedger = projectMaterialFlow(seed.stock, p.id).attributableCost;
      // Materiales también incluye trabajo comprado hecho (Lote 4): se compara con el costo de los consumos.
      const fromUsages = projectEconomics(p).materialActualCost;
      expect(Math.abs(fromLedger - fromUsages), `${p.code}: ledger ${fromLedger} vs registros ${fromUsages}`).toBeLessThan(1);
    }
  });

  it("los sobrantes disponibles coinciden con el pool anterior", () => {
    const legacy = new Map<string, number>();
    for (const m of seed.legacyPool) legacy.set(m.materialId, (legacy.get(m.materialId) ?? 0) + m.quantity);
    const derived = new Map<string, number>();
    for (const l of leftoverRows(seed.stock)) derived.set(l.lot.materialId, (derived.get(l.lot.materialId) ?? 0) + l.quantity);
    for (const [k, q] of legacy) expect(derived.get(k) ?? 0).toBeCloseTo(q, 3);
    for (const [k, q] of derived) expect(legacy.get(k) ?? 0).toBeCloseTo(q, 3);
  });

  it("los proyectos cerrados no dejan material en el aire", () => {
    for (const p of seed.projects.filter((x) => x.isClosed)) expect(projectHoldings(seed.stock, p.id)).toHaveLength(0);
  });

  it("es determinística: derivar dos veces da los mismos ids", () => {
    const again = deriveLedgerFromLegacy(seed.projects, seed.legacyPool);
    expect(again).toEqual(seed.stock);
  });

  it("nada tiene costo cero en el stock", () => {
    for (const r of stockRows(seed.stock)) expect(r.unitCost).toBeGreaterThan(0);
  });
});
