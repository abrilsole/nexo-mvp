"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
// Días laborales de un operario y sus excepciones por fecha (Lote 6 · Fase 3). Lo edita el Jefe de planta (o un
// Administrativo); la base lo guarda con planta_save_schedule. Define la capacidad de cada día en el calendario.
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { formatDate, formatNumber, todayISO } from "@/lib/formatting";
import { parseDecimal } from "@/lib/schemas";
import { DEFAULT_WORK_DAYS, WEEKDAY_NAMES, workDaysLabel, workDaysOf } from "@/lib/schedule";
import { useAppStore } from "@/store/use-app-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Lunes primero. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function ScheduleDialog({ operatorId, onClose }: { operatorId: string | null; onClose: () => void }) {
  return (
    <Dialog open={operatorId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{operatorId && <ScheduleForm key={operatorId} operatorId={operatorId} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function ScheduleForm({ operatorId, onClose }: { operatorId: string; onClose: () => void }) {
  const operator = useAppStore((s) => s.operators.find((o) => o.id === operatorId));
  const allExceptions = useAppStore((s) => s.dayExceptions);
  const hoursPerDay = useAppStore((s) => s.costSettings.hoursPerDay);
  const saveSchedule = useConfirmedAction("saveSchedule");
  const today = todayISO();
  const exceptions = allExceptions.filter((x) => x.operatorId === operatorId && x.date >= today);
  const [days, setDays] = useState<number[]>(() => (operator ? workDaysOf(operator) : DEFAULT_WORK_DAYS));
  const [date, setDate] = useState("");
  const [works, setWorks] = useState(true);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (!operator) return null;

  const toggle = (d: number) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  const saveDays = async () => {
    const r = await saveSchedule(operatorId, { workDays: days });
    if (!r.ok) return setError(r.error);
    setError("");
  };
  const addException = async () => {
    const r = await saveSchedule(operatorId, { add: [{ date, works, hours: works && hours.trim() ? parseDecimal(hours) : undefined, note }] });
    if (!r.ok) return setError(r.error);
    setError("");
    setDate("");
    setHours("");
    setNote("");
  };
  const changed = workDaysLabel(days) !== workDaysLabel(workDaysOf(operator));

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle>Días laborales de {operator.name}</DialogTitle>
        <DialogDescription>
          Los días que trabaja cada semana definen su disponibilidad en el calendario. Una excepción manda sobre eso para una fecha puntual (por ejemplo,
          &quot;trabaja este sábado&quot;).
        </DialogDescription>
      </DialogHeader>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Trabaja los días</legend>
        <div className="flex flex-wrap gap-2">
          {WEEK_ORDER.map((d) => (
            <label key={d} className="flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-sm capitalize">
              <input type="checkbox" className="size-4" checked={days.includes(d)} onChange={() => toggle(d)} />
              {WEEKDAY_NAMES[d]}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={saveDays} disabled={!changed}>Guardar días</Button>
          <span className="text-xs text-slate-500">Ahora: {workDaysLabel(workDaysOf(operator))}.</span>
        </div>
      </fieldset>

      <section aria-label="Excepciones" className="space-y-2">
        <h3 className="text-sm font-medium text-slate-700">Excepciones (desde hoy)</h3>
        {exceptions.length === 0 ? (
          <p className="text-sm text-slate-500">No tiene excepciones.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {exceptions.map((x) => (
              <li key={x.date} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 break-words">
                  {formatDate(x.date)}: {x.works ? `trabaja ${formatNumber(x.hours ?? hoursPerDay)} h` : "no trabaja"}
                  {x.note && <span className="text-slate-500"> · {x.note}</span>}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Quitar la excepción del ${formatDate(x.date)}`}
                  onClick={async () => {
                    const r = await saveSchedule(operatorId, { remove: [x.date] });
                    if (!r.ok) setError(r.error);
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-2">
          <Field label="Fecha" htmlFor="exc-date">
            <Input id="exc-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Ese día" htmlFor="exc-works">
            <select id="exc-works" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm" value={works ? "yes" : "no"} onChange={(e) => setWorks(e.target.value === "yes")}>
              <option value="yes">Trabaja</option>
              <option value="no">No trabaja</option>
            </select>
          </Field>
          {works && (
            <Field label="Horas (opcional)" htmlFor="exc-hours" hint={`Sin dato: la jornada (${formatNumber(hoursPerDay)} h).`}>
              <Input id="exc-hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
          )}
          <Field label="Nota (opcional)" htmlFor="exc-note">
            <Input id="exc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: entrega urgente" />
          </Field>
          <div className="col-span-2">
            <Button size="sm" variant="outline" onClick={addException} disabled={!date}>Agregar excepción</Button>
          </div>
        </div>
      </section>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cerrar</Button>
      </DialogFooter>
    </div>
  );
}
