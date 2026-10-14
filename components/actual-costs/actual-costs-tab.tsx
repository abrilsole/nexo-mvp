"use client";
import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import type { BudgetCategory, Project } from "@/types";
import { actualEntryLabel, CATEGORY_LABELS, CATEGORY_ORDER, SOURCE_LABELS } from "@/lib/constants";
import { usageProjectCost } from "@/lib/calculations";
import { formatCurrency, formatDate, formatNumber, formatQty } from "@/lib/formatting";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";

interface Row {
  id: string;
  date: string;
  createdAt: string;
  type: string;
  description: string;
  category: BudgetCategory;
  qty: string;
  amount: number;
  user: string;
}

/** Tabla cronológica de todo lo que impacta en el costo imputable (consumos + costos). Las compras no aparecen: no son costo. */
export function ActualCostsTab({ project }: { project: Project }) {
  const [cat, setCat] = useState<BudgetCategory | "all">("all");
  const [user, setUser] = useState("all");
  const rows = useMemo<Row[]>(() => {
    const usage: Row[] = project.materialUsages.map((u) => ({
      id: u.id,
      date: u.date,
      createdAt: u.createdAt,
      type: "Material utilizado",
      description: `${u.materialName} · ${SOURCE_LABELS[u.source]}`,
      category: "materials",
      qty: `${formatQty(u.quantityConsumed, u.unit)}${u.wasteQuantity ? ` + ${formatNumber(u.wasteQuantity)} desp.` : ""}`,
      amount: usageProjectCost(u),
      user: u.createdBy,
    }));
    const costs: Row[] = project.actualEntries.map((e) => ({
      id: e.id,
      date: e.date,
      createdAt: e.createdAt,
      type: actualEntryLabel(e),
      description: e.description + (e.supplier ? ` · ${e.supplier}` : ""),
      category: e.category,
      qty: e.labor ? `${formatNumber(e.labor.hours, 1)} h × ${formatCurrency(e.labor.hourlyCost)}` : "—",
      amount: e.amount,
      user: e.createdBy,
    }));
    return [...usage, ...costs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [project]);
  const users = [...new Set(rows.map((r) => r.user))];
  const filtered = rows.filter((r) => (cat === "all" || r.category === cat) && (user === "all" || r.user === user));
  const total = filtered.reduce((s, r) => s + r.amount, 0);

  if (rows.length === 0) return <EmptyState icon={Receipt} title="Todavía no hay costos reales registrados" description="Usá “Registrar lo que pasó” o pedile al taller que cargue sus registros." />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label htmlFor="c-cat" className="sr-only">Categoría</label>
        <Select id="c-cat" className="w-48" value={cat} onChange={(e) => setCat(e.target.value as BudgetCategory | "all")}>
          <option value="all">Todas las categorías</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </Select>
        <label htmlFor="c-user" className="sr-only">Usuario</label>
        <Select id="c-user" className="w-48" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="all">Todos los usuarios</option>
          {users.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </Select>
        <div className="ml-auto self-center text-sm text-slate-600">
          Total filtrado: <strong className="tabular">{formatCurrency(total)}</strong>
        </div>
      </div>
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Fecha</TH>
              <TH>Tipo</TH>
              <TH>Descripción</TH>
              <TH>Categoría</TH>
              <TH>Cantidad / horas</TH>
              <TH className="text-right">Monto</TH>
              <TH>Usuario</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap tabular">{formatDate(r.date)}</TD>
                <TD className="whitespace-nowrap">{r.type}</TD>
                <TD className="min-w-56 text-slate-900">{r.description}</TD>
                <TD className="whitespace-nowrap text-slate-500">{CATEGORY_LABELS[r.category]}</TD>
                <TD className="whitespace-nowrap text-xs tabular">{r.qty}</TD>
                <TD className="text-right font-medium tabular">{formatCurrency(r.amount)}</TD>
                <TD className="whitespace-nowrap text-slate-500">{r.user}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
