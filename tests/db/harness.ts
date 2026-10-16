// Postgres real en memoria (PGlite) con lo mínimo de Supabase para probar las políticas:
// auth.users + auth.uid(), rol "authenticated", Storage, y TODAS las migraciones del repo.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../supabase/migrations");
// Partes que se corren a mano (tienen DROP o DELETE): se aplican en orden junto con las migraciones.
const MANUAL = path.resolve(import.meta.dirname, "../../supabase/manual");

/** Migraciones y partes manuales, en orden por nombre (fecha). */
function sqlFiles(): { name: string; file: string }[] {
  const list = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".sql")).map((name) => ({ name, file: path.join(dir, name) }));
  return [...list(MIGRATIONS), ...list(MANUAL)].sort((a, b) => a.name.localeCompare(b.name));
}

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant authenticated to postgres;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;

  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;

  -- Como Supabase: los roles de la API tienen permisos de tabla; RLS decide las filas.
  grant usage on schema public to authenticated, anon;
  alter default privileges in schema public grant all on tables to authenticated, anon;
  alter default privileges in schema public grant all on functions to authenticated, anon;
`;

/** Base con las migraciones aplicadas. Con `before`, solo las anteriores a ese prefijo (para probar una migración sobre datos viejos). */
export async function createDb(opts: { before?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of sqlFiles()) {
    if (opts.before && f.name >= opts.before) break;
    await db.exec(readFileSync(f.file, "utf8"));
  }
  return db;
}

/** Aplica las migraciones (y partes manuales) desde el prefijo `from` en adelante. */
export async function migrateFrom(db: PGlite, from: string): Promise<void> {
  for (const f of sqlFiles()) if (f.name >= from) await db.exec(readFileSync(f.file, "utf8"));
}

/** Corre `fn` como un usuario logueado (rol authenticated con su id), igual que la API de Supabase. */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

/** Igual que asUser, pero devuelve el mensaje de error de Postgres (o null si no falló). */
export async function errorAs(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<unknown>): Promise<string | null> {
  try {
    await asUser(db, userId, fn);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Alta de un usuario como lo hace Supabase al registrarse (dispara handle_new_user). */
export async function signUp(db: PGlite, email: string, name: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id",
    [email, name],
  );
  return r.rows[0].id;
}

/**
 * Lote 6: toda hora es contra una asignación. Crea (como `userId`, Administrativo o Jefe de planta) la asignación de
 * un operario en el mostrador de P-1042 ese día y devuelve su id.
 */
export async function assignFor(db: PGlite, userId: string, operatorId: string, date: string, id = `asg-${operatorId}-${date}`): Promise<string> {
  // Datos cargados antes de la migración del Lote 6 (migrateFrom): el producto todavía no tenía rubros.
  await db.query(`update project_items set rubros = '[{"rubro":"carpinteria_madera","hours":30,"workers":1}]' where id = 'itm-mostrador' and rubros = '[]'`);
  await asUser(db, userId, (tx) =>
    tx.query("select planta_save_assignment($1::jsonb)", [
      JSON.stringify({ id, project_id: "p-1042", item_id: "itm-mostrador", rubro: "carpinteria_madera", operator_id: operatorId, date, planned_hours: 8 }),
    ]),
  );
  return id;
}
