import { APP_NAME } from "@/lib/constants";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { Logo } from "@/components/landing/primitives";
import { safeNext } from "@/lib/supabase/safe-next";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED } from "@/lib/supabase/env";

export const metadata: Metadata = { title: `Acceder · ${APP_NAME}` };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  const authError = params.error === "auth";
  const inviteNotice = params.error === "invite";

  return (
    <div className="landing relative flex min-h-screen flex-col overflow-hidden">
      <div className="landing-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="landing-glow pointer-events-none absolute inset-x-0 top-0 h-[600px]" aria-hidden />

      <header className="relative px-4 pt-6 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Volver al sitio
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm rounded-3xl border border-line bg-white/80 p-8 text-center shadow-[0_40px_80px_-40px_rgb(39_45_120/0.35)] backdrop-blur-xl sm:p-10">
          <Link href="/" aria-label={`${APP_NAME}, inicio`} className="inline-block">
            <Logo />
          </Link>
          <h1 className="mt-8 text-2xl font-semibold tracking-[-0.03em] text-ink">Accedé a {APP_NAME}</h1>
          <p className="mt-2 text-sm text-pretty text-ink-soft">
            Entrá con tu cuenta de Google. La primera vez creamos tu empresa con los datos demo de Madera Sur S.R.L.
          </p>
          {!isSupabaseConfigured && (
            <p role="alert" className="mt-6 rounded-xl bg-bad/5 px-3 py-2 text-sm text-bad ring-1 ring-bad/20">
              {SUPABASE_NOT_CONFIGURED}
            </p>
          )}
          {authError && (
            <p role="alert" className="mt-6 rounded-xl bg-bad/5 px-3 py-2 text-sm text-bad ring-1 ring-bad/20">
              No pudimos iniciar sesión. Probá de nuevo.
            </p>
          )}
          {inviteNotice && (
            <p role="status" className="mt-6 rounded-xl bg-white px-3 py-2 text-sm text-ink-soft ring-1 ring-line">
              Tu invitación quedó confirmada. Entrá con Google usando el mismo mail al que te llegó la invitación.
            </p>
          )}
          <div className="mt-8">
            <GoogleSignInButton next={next} />
          </div>
          <p className="mt-6 text-xs text-ink-faint">
            Solo usamos tu nombre y tu email para identificarte dentro de tu empresa.
          </p>
        </div>
      </main>
    </div>
  );
}
