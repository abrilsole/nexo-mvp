import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/** Rutas públicas: el landing, el login, el intercambio del código OAuth y la confirmación de una invitación. */
const PUBLIC_PATHS = ["/", "/login", "/auth/callback", "/auth/confirm"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * Refresca la sesión de Supabase en cada request y redirige a /login si una ruta privada
 * se pide sin sesión. Es un chequeo optimista: la autorización real la hace RLS en la base.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Sin variables de Supabase no hay sesión posible: el sitio público sigue andando
  // y las rutas privadas van a /login, que explica qué falta.
  if (!isSupabaseConfigured) {
    const { pathname } = request.nextUrl;
    if (isPublic(pathname)) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // No meter código entre createServerClient y getClaims (ver docs de @supabase/ssr).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
