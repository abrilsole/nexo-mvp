"use server";
// Invitación de usuarios (Lote 5A). La invitación la registra la base con la sesión de quien invita
// (admin_invite_member exige un usuario Administrativo activo); el mail lo manda Supabase Auth con la
// service role, que solo existe en el servidor.
import { headers } from "next/headers";
import { dbRoleOf } from "@/lib/permissions";
import { newUserSchema } from "@/lib/users";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";

export interface InviteResult {
  ok: boolean;
  message: string;
}

export async function inviteUser(input: unknown): Promise<InviteResult> {
  const parsed = newUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  const u = parsed.data;

  const db = await createClient();
  const { error } = await db.rpc("admin_invite_member", {
    p: { email: u.email, display_name: u.displayName, role: dbRoleOf(u.role), operator_id: u.role === "operario" ? u.operatorId : null },
  });
  if (error) return { ok: false, message: error.message };

  const admin = serviceClient();
  if (!admin) {
    return { ok: true, message: `Invitación guardada. Todavía no está configurado el envío de mails: avisale a ${u.displayName} que entre con Google usando ${u.email}.` };
  }
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(u.email, {
    redirectTo: `${origin}/auth/confirm?next=/dashboard`,
    data: { full_name: u.displayName },
  });
  if (mailError) {
    return { ok: true, message: `Invitación guardada, pero no se pudo mandar el mail (${mailError.message}). ${u.displayName} puede entrar con Google usando ${u.email}.` };
  }
  return { ok: true, message: `Invitación enviada a ${u.email}.` };
}
