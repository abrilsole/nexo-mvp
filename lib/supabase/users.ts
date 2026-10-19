// Usuarios de la empresa (Lote 5A): llamadas a las funciones admin_* de la base, con la sesión del usuario.
// La base exige un usuario Administrativo activo y aplica las reglas (ver lib/users.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbRoleOf, type RoleKey } from "@/lib/permissions";
import { membersFromJson, type Invitation, type Member } from "@/lib/users";

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function loadMembers(db: SupabaseClient): Promise<{ members: Member[]; invitations: Invitation[] }> {
  return membersFromJson(check(await db.rpc("admin_members")) as Parameters<typeof membersFromJson>[0]);
}

export async function setMemberRole(db: SupabaseClient, userId: string, role: RoleKey, operatorId?: string) {
  check(await db.rpc("admin_set_member_role", { p_user: userId, p_role: dbRoleOf(role), p_operator_id: operatorId ?? null }));
}

export async function setMemberActive(db: SupabaseClient, userId: string, active: boolean) {
  check(await db.rpc("admin_set_member_active", { p_user: userId, p_active: active }));
}

export async function revokeInvitation(db: SupabaseClient, id: string) {
  check(await db.rpc("admin_revoke_invitation", { p_id: id }));
}

export async function setCommercialAccess(db: SupabaseClient, userId: string, enabled: boolean) {
  check(await db.rpc("admin_set_commercial_access", { p_user: userId, p_enabled: enabled }));
}
