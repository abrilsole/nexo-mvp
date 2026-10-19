// ─────────────────────────────────────────────────────────────
// Usuarios de la empresa (Lote 5A) — funciones puras.
// "Usuario" = cuenta para entrar (organization_members). "Persona" = operario con su costo por hora
// (operators): un operario puede existir sin usuario. Las mismas reglas las aplica la base
// (admin_* y el trigger guard_members); acá se validan antes para avisar en pantalla.
// ─────────────────────────────────────────────────────────────
import { z } from "zod";
import type { AppRole } from "@/types";
import { roleKeyOf, ROLE_KEYS, type RoleKey } from "./permissions";

export interface Member {
  userId: string;
  displayName: string;
  email: string;
  role: AppRole;
  deactivatedAt?: string;
  createdAt: string;
  /** Persona de Operarios vinculada (solo Operario). */
  operatorId?: string;
  isSelf: boolean;
  canViewCommercial?: boolean;
}

export interface Invitation {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  operatorId?: string;
  createdAt: string;
}

const isAdmin = (m: Pick<Member, "role" | "deactivatedAt">) => roleKeyOf(m.role) === "admin" && !m.deactivatedAt;

/** Por qué no se puede cambiar el rol de un usuario (o null si se puede). */
export function roleChangeError(members: Member[], target: Member, to: RoleKey): string | null {
  if (target.isSelf) return "No podés cambiar tu propio rol.";
  if (roleKeyOf(target.role) === to) return null;
  if (isAdmin(target) && !members.some((m) => m.userId !== target.userId && isAdmin(m))) {
    return "La empresa tiene que tener al menos un usuario Administrativo activo.";
  }
  return null;
}

/** Por qué no se puede dar de baja a un usuario (o null si se puede). */
export function deactivateError(members: Member[], target: Member): string | null {
  if (target.isSelf) return "No podés darte de baja a vos mismo.";
  if (isAdmin(target) && !members.some((m) => m.userId !== target.userId && isAdmin(m))) {
    return "No se puede dar de baja al último usuario Administrativo.";
  }
  return null;
}

/** Alta de un usuario: nombre, rol y mail de invitación. Un Operario se vincula a una persona de Operarios. */
export const newUserSchema = z
  .object({
    displayName: z.string().trim().min(2, "Ingresá el nombre."),
    email: z.string().trim().toLowerCase().email("Ingresá un mail válido."),
    role: z.enum(ROLE_KEYS as [RoleKey, ...RoleKey[]], { error: "Elegí un rol." }),
    operatorId: z.string().optional(),
  })
  .refine((v) => v.role !== "operario" || !!v.operatorId, { path: ["operatorId"], message: "Elegí qué operario es." });

export type NewUser = z.infer<typeof newUserSchema>;

/** Filas que devuelve admin_members() → modelo. */
export function membersFromJson(json: { members?: Record<string, unknown>[]; invitations?: Record<string, unknown>[] }): { members: Member[]; invitations: Invitation[] } {
  const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  return {
    members: (json.members ?? []).map((m) => ({
      userId: String(m.user_id),
      displayName: String(m.display_name ?? ""),
      email: String(m.email ?? ""),
      role: m.role as AppRole,
      deactivatedAt: str(m.deactivated_at),
      createdAt: String(m.created_at),
      operatorId: str(m.operator_id),
      isSelf: Boolean(m.is_self),
      canViewCommercial: Boolean(m.can_view_commercial),
    })),
    invitations: (json.invitations ?? []).map((i) => ({
      id: String(i.id),
      email: String(i.email),
      displayName: String(i.display_name),
      role: i.role as AppRole,
      operatorId: str(i.operator_id),
      createdAt: String(i.created_at),
    })),
  };
}
