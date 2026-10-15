"use client";
import { useAppStore } from "@/store/use-app-store";
import { Choice } from "@/components/ui/choice";
import { DEMO_USERS } from "@/lib/constants";
import { ROLE_KEYS, ROLE_LABELS, roleKeyOf, type RoleKey } from "@/lib/permissions";

/**
 * Demo: mirar la app con cada uno de los cuatro roles, cada uno con su usuario de ejemplo.
 * Solo aparece en una empresa demo y para un usuario Administrativo (nunca en una empresa real).
 */
export function ModeSwitch() {
  const mode = useAppStore((s) => s.currentMode);
  const setMode = useAppStore((s) => s.setMode);
  const isDemo = useAppStore((s) => s.isDemo);
  const role = useAppStore((s) => s.role);
  if (!isDemo || roleKeyOf(role) !== "admin") return null;
  const who: Record<RoleKey, string> = {
    admin: DEMO_USERS.admin.name,
    compras: DEMO_USERS.compras.name,
    jefe_planta: DEMO_USERS.jefe_planta.name,
    operario: "el operario que elijas",
  };
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-500">Demo: ver como</div>
      <Choice<RoleKey> name="Ver la demo como" value={mode} onChange={setMode} columns={2} options={ROLE_KEYS.map((k) => ({ value: k, label: ROLE_LABELS[k] }))} />
      <p className="mt-1.5 text-xs text-slate-500">Usuario de ejemplo: {who[mode]}.</p>
    </div>
  );
}
