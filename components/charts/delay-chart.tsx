"use client";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DelayScenario } from "@/lib/delay";
import { formatCurrency, formatPercent } from "@/lib/formatting";

function Tip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DelayScenario }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-slate-900">+{d.days} días hábiles</div>
      <div className="text-slate-600">Costo: <span className="tabular">{formatCurrency(d.cost)}</span></div>
      <div className="text-slate-600">Rentabilidad: <span className="tabular">{formatPercent(d.margin)}</span></div>
    </div>
  );
}

/** Rentabilidad según los días de atraso. La línea punteada es el piso de rentabilidad; la roja, ganancia cero. */
export function DelayChart({ points, floorPct }: { points: DelayScenario[]; floorPct: number }) {
  return (
    <div className="h-56 w-full" role="img" aria-label={`Rentabilidad según los días de atraso, comparada con el piso de ${formatPercent(floorPct)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="days" tickLine={false} axisLine={{ stroke: "#cbd5e1" }} tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={(v: number) => `+${v}`} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={(v: number) => `${Math.round(v)}%`} />
          <Tooltip content={<Tip />} />
          <ReferenceLine y={floorPct} stroke="#94a3b8" strokeDasharray="4 4" />
          <ReferenceLine y={0} stroke="#dc2626" strokeOpacity={0.5} />
          <Line type="monotone" dataKey="margin" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
