import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/supabase/safe-next";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const OTP_TYPES: EmailOtpType[] = ["invite", "magiclink", "email", "signup"];

/**
 * Link del mail de invitación (Lote 5A). Con la plantilla "Invite user" de Supabase apuntando acá
 * (?token_hash=…&type=invite) la persona entra directo. Si no, la invitación igual quedó confirmada:
 * se la manda al login para que entre con Google con ese mail (docs/ROLES_Y_PERMISOS.md).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && type && OTP_TYPES.includes(type) && isSupabaseConfigured) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=invite`);
}
