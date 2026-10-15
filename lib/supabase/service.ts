import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Cliente con la service role de Supabase: SOLO del lado del servidor (este módulo no se puede importar
 * desde el navegador). Se usa únicamente para mandar el mail de invitación. La clave va en
 * SUPABASE_SERVICE_ROLE_KEY (sin NEXT_PUBLIC_, así nunca llega al navegador). Sin la clave, null.
 */
export function serviceClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !SUPABASE_URL) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
