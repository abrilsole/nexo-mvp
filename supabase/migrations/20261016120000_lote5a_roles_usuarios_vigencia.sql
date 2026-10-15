-- ─────────────────────────────────────────────────────────────
-- Lote 5A · Roles, usuarios y precios con vigencia.
--
-- 1. Cuatro roles. El valor interno de Administrativo sigue siendo owner/member (no se
--    renombra: lo usan todas las políticas). Se suman compras y jefe_planta; operator es
--    Operario. Ampliar la regla (check) de la columna role requiere un DROP: va en
--    supabase/manual/20261016120100_lote5a_manual.sql, que se corre a mano ANTES de
--    invitar usuarios de Compras o Jefe de planta.
-- 2. Compras y Jefe de planta NO tienen acceso directo a ninguna tabla con importes
--    (las políticas siguen siendo solo de Administrativo): leen por compras_workspace()
--    y planta_workspace(), que devuelven solo las columnas permitidas (como taller_workspace()).
-- 3. Usuarios: baja y reactivación de cuentas (organization_members.deactivated_at),
--    invitaciones por mail, cambio de rol. Siempre queda al menos un Administrativo activo
--    y nadie se cambia el rol ni se da de baja a sí mismo (trigger).
-- 4. Precios con vigencia: price_history guarda cada tarifa, multiplicador, costo por hora
--    de operario y precio de material con su "vigente desde". Solo crece. Las horas que
--    carga un operario se valúan con el valor vigente ESE día.
-- 5. Proyectos aprobados o cerrados: precio de venta y costo presupuestado congelados.
--    Se corrigen solo con admin_correct_value(), que deja un registro auditado.
--
-- Sin DROP ni DELETE: ADD COLUMN / CREATE ... IF NOT EXISTS / CREATE OR REPLACE / INSERT.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Roles y acceso ────────────────────────────────────────

alter table public.organization_members add column if not exists deactivated_at timestamptz;

/** Rol vigente del usuario en la empresa (null si no es miembro o su cuenta está dada de baja). */
create or replace function private.member_role(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.organization_members m
  where m.organization_id = org and m.user_id = (select auth.uid()) and m.deactivated_at is null;
$$;

/** Administrativo (owner/member) con la cuenta activa. */
create or replace function private.is_org_manager(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.member_role(org) in ('owner', 'member'), false);
$$;

/** Compras o Jefe de planta con la cuenta activa. */
create or replace function private.is_staff(org uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.member_role(org) = p_role, false);
$$;

/** Operario activo: además de la cuenta, la persona (operators) tiene que estar activa. */
create or replace function private.taller_me()
returns table (organization_id uuid, operator_id text, operator_name text, operator_role text, operator_email text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.organization_id, o.id, o.name, o.role, o.email, o.created_at
  from public.organization_members m
  join public.operators o on o.organization_id = m.organization_id and o.user_id = m.user_id
  where m.user_id = (select auth.uid())
    and m.role = 'operator'
    and m.deactivated_at is null
    and o.active
    and o.deactivated_at is null
  order by o.created_at
  limit 1;
$$;

/** Miembro con acceso vigente, cualquiera sea su rol (lee el nombre de la empresa). */
create or replace function private.is_active_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_manager(org)
      or private.active_operator_id(org) is not null
      or private.is_staff(org, 'compras')
      or private.is_staff(org, 'jefe_planta');
$$;

/**
 * Lo usan solo las políticas de Storage (archivos de proyectos), que no se pueden cambiar por migración.
 * Archivos: Administrativo, Operario activo y Jefe de planta. Compras no (pueden tener precios de venta).
 */
create or replace function private.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_manager(org)
      or private.active_operator_id(org) is not null
      or private.is_staff(org, 'jefe_planta');
$$;

/** Empresa donde el usuario es Administrativo activo. Lanza si no lo es. */
create or replace function private.my_admin_org()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  select m.organization_id into org
  from public.organization_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'member') and m.deactivated_at is null
  order by m.created_at
  limit 1;
  if org is null then
    raise exception 'Solo un usuario Administrativo puede hacer esto.' using errcode = 'insufficient_privilege';
  end if;
  return org;
end;
$$;

revoke all on function private.member_role(uuid) from public;
revoke all on function private.is_staff(uuid, text) from public;
revoke all on function private.my_admin_org() from public;
grant execute on function private.member_role(uuid) to authenticated;
grant execute on function private.is_staff(uuid, text) to authenticated;
grant execute on function private.my_admin_org() to authenticated;

-- Persona (operators) ≠ usuario (organization_members). Un operario puede existir sin cuenta.
-- Preparado para operarios sin mail (pregunta abierta al cliente): acceso con PIN, sin uso todavía.
alter table public.operators add column if not exists pin_hash text;
comment on column public.operators.pin_hash is
  'Reservado (Lote 5A): acceso con PIN para operarios sin mail. Pregunta abierta al cliente; la app todavía no lo usa.';

-- ── 2. Usuarios: invitaciones, rol, baja ─────────────────────

create table if not exists public.member_invitations (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  email text not null,
  display_name text not null,
  role text not null check (role in ('member', 'compras', 'jefe_planta', 'operator')),
  operator_id text,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  primary key (organization_id, id)
);
create unique index if not exists member_invitations_pending_email_idx
  on public.member_invitations (lower(email)) where accepted_at is null and revoked_at is null;

alter table public.member_invitations enable row level security;
revoke all on public.member_invitations from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'member_invitations' and policyname = 'managers read invitations') then
    create policy "managers read invitations" on public.member_invitations for select to authenticated
      using ((select private.is_org_manager(organization_id)));
  end if;
end $$;

/** Siempre queda al menos un Administrativo activo, y nadie se cambia el rol ni se da de baja a sí mismo. */
create or replace function private.guard_members()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.user_id
     and (new.role is distinct from old.role or new.deactivated_at is distinct from old.deactivated_at) then
    raise exception 'No podés cambiar tu propio rol ni darte de baja.' using errcode = 'check_violation';
  end if;
  if old.role in ('owner', 'member') and old.deactivated_at is null
     and (new.role not in ('owner', 'member') or new.deactivated_at is not null)
     and not exists (
       select 1 from public.organization_members m
       where m.organization_id = old.organization_id and m.user_id <> old.user_id
         and m.role in ('owner', 'member') and m.deactivated_at is null
     ) then
    raise exception 'La empresa tiene que tener al menos un usuario Administrativo activo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace trigger guard_members before update on public.organization_members
  for each row execute function private.guard_members();

/** Usuarios de la empresa (con su mail) e invitaciones pendientes. Solo Administrativo. */
create or replace function public.admin_members()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_admin_org();
begin
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', m.display_name,
        'email', u.email,
        'role', m.role,
        'deactivated_at', m.deactivated_at,
        'created_at', m.created_at,
        'operator_id', o.id,
        'is_self', m.user_id = (select auth.uid())
      ) order by m.created_at)
      from public.organization_members m
      left join auth.users u on u.id = m.user_id
      left join public.operators o on o.organization_id = m.organization_id and o.user_id = m.user_id
      where m.organization_id = org), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'display_name', i.display_name, 'role', i.role,
        'operator_id', i.operator_id, 'created_at', i.created_at
      ) order by i.created_at)
      from public.member_invitations i
      where i.organization_id = org and i.accepted_at is null and i.revoked_at is null), '[]'::jsonb)
  );
end;
$$;

/**
 * Invitación: queda pendiente hasta que la persona entra con ese mail (Google o el link de invitación).
 * Operario: se vincula a una persona de Operarios que todavía no tenga cuenta.
 */
create or replace function public.admin_invite_member(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_admin_org();
  v_email text := lower(trim(coalesce(p ->> 'email', '')));
  v_name text := trim(coalesce(p ->> 'display_name', ''));
  v_role text := p ->> 'role';
  v_operator text := nullif(p ->> 'operator_id', '');
  v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Ingresá un mail válido.' using errcode = 'check_violation';
  end if;
  if length(v_name) < 2 then
    raise exception 'Ingresá el nombre.' using errcode = 'check_violation';
  end if;
  if v_role is null or v_role not in ('member', 'compras', 'jefe_planta', 'operator') then
    raise exception 'Elegí un rol válido.' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.organization_members m join auth.users u on u.id = m.user_id
    where m.organization_id = org and lower(u.email) = v_email
  ) then
    raise exception 'Ese mail ya es un usuario de la empresa.' using errcode = 'unique_violation';
  end if;
  if exists (
    select 1 from public.member_invitations i
    where lower(i.email) = v_email and i.organization_id <> org and i.accepted_at is null and i.revoked_at is null
  ) then
    raise exception 'Ese mail tiene una invitación pendiente de otra empresa.' using errcode = 'unique_violation';
  end if;
  if v_role = 'operator' then
    if v_operator is null or not exists (
      select 1 from public.operators o
      where o.organization_id = org and o.id = v_operator and o.active and o.deactivated_at is null and o.user_id is null
    ) then
      raise exception 'Elegí un operario activo que todavía no tenga usuario.' using errcode = 'check_violation';
    end if;
    update public.operators set email = v_email where organization_id = org and id = v_operator;
  else
    v_operator := null;
  end if;

  -- Una sola invitación pendiente por mail: la nueva reemplaza a la anterior de esta empresa.
  update public.member_invitations set revoked_at = now()
  where organization_id = org and lower(email) = v_email and accepted_at is null and revoked_at is null;
  insert into public.member_invitations (organization_id, email, display_name, role, operator_id, invited_by)
  values (org, v_email, v_name, v_role, v_operator, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_admin_org();
begin
  update public.member_invitations set revoked_at = now()
  where organization_id = org and id = p_id and accepted_at is null and revoked_at is null;
end;
$$;

/** Cambio de rol. A Operario: se vincula a una persona de Operarios. De Operario a otro rol: se desvincula. */
create or replace function public.admin_set_member_role(p_user uuid, p_role text, p_operator_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_admin_org();
  old_role text;
begin
  if p_user = (select auth.uid()) then
    raise exception 'No podés cambiar tu propio rol.' using errcode = 'check_violation';
  end if;
  if p_role is null or p_role not in ('member', 'compras', 'jefe_planta', 'operator') then
    raise exception 'Elegí un rol válido.' using errcode = 'check_violation';
  end if;
  select m.role into old_role from public.organization_members m where m.organization_id = org and m.user_id = p_user;
  if old_role is null then
    raise exception 'El usuario no es de tu empresa.' using errcode = 'no_data_found';
  end if;
  if old_role = 'owner' and p_role = 'member' then
    return; -- los dos son Administrativo
  end if;
  if p_role = 'operator' and old_role <> 'operator' then
    if p_operator_id is null or not exists (
      select 1 from public.operators o
      where o.organization_id = org and o.id = p_operator_id and o.active and o.deactivated_at is null and o.user_id is null
    ) then
      raise exception 'Elegí un operario activo que todavía no tenga usuario.' using errcode = 'check_violation';
    end if;
    update public.operators set user_id = p_user where organization_id = org and id = p_operator_id;
  elsif old_role = 'operator' and p_role <> 'operator' then
    update public.operators set user_id = null where organization_id = org and user_id = p_user;
  end if;
  update public.organization_members set role = p_role where organization_id = org and user_id = p_user;
end;
$$;

/** Baja y reactivación de una cuenta (la persona de Operarios se da de baja aparte, con reasignación). */
create or replace function public.admin_set_member_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_admin_org();
begin
  if p_user = (select auth.uid()) then
    raise exception 'No podés darte de baja a vos mismo.' using errcode = 'check_violation';
  end if;
  update public.organization_members
  set deactivated_at = case when p_active then null else coalesce(deactivated_at, now()) end
  where organization_id = org and user_id = p_user;
  if not found then
    raise exception 'El usuario no es de tu empresa.' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.admin_members() from public, anon;
revoke all on function public.admin_invite_member(jsonb) from public, anon;
revoke all on function public.admin_revoke_invitation(uuid) from public, anon;
revoke all on function public.admin_set_member_role(uuid, text, text) from public, anon;
revoke all on function public.admin_set_member_active(uuid, boolean) from public, anon;
grant execute on function public.admin_members() to authenticated;
grant execute on function public.admin_invite_member(jsonb) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_set_member_role(uuid, text, text) to authenticated;
grant execute on function public.admin_set_member_active(uuid, boolean) to authenticated;

/**
 * Alta de usuarios: 1) invitación pendiente con ese mail → entra a esa empresa con ese rol;
 * 2) operario cargado con ese mail (Lote 2); 3) si no, empresa nueva como owner.
 */
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org uuid;
  inv public.member_invitations%rowtype;
  invited public.operators%rowtype;
  display text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );
begin
  if new.email is not null then
    select * into inv
    from public.member_invitations i
    where lower(i.email) = lower(new.email) and i.accepted_at is null and i.revoked_at is null
    order by i.created_at desc
    limit 1;
    if found then
      insert into public.organization_members (organization_id, user_id, role, display_name)
      values (inv.organization_id, new.id, inv.role, inv.display_name);
      if inv.role = 'operator' and inv.operator_id is not null then
        update public.operators set user_id = new.id
        where organization_id = inv.organization_id and id = inv.operator_id and user_id is null;
      end if;
      update public.member_invitations set accepted_at = now(), accepted_user_id = new.id
      where organization_id = inv.organization_id and id = inv.id;
      return new;
    end if;
  end if;

  select * into invited
  from public.operators o
  where o.user_id is null and o.active and o.deactivated_at is null
    and new.email is not null and lower(o.email) = lower(new.email)
  order by o.created_at
  limit 1;
  if found then
    insert into public.organization_members (organization_id, user_id, role, display_name)
    values (invited.organization_id, new.id, 'operator', invited.name);
    update public.operators set user_id = new.id
    where organization_id = invited.organization_id and id = invited.id;
    return new;
  end if;

  insert into public.organizations (name) values ('Empresa de ' || display) returning id into new_org;
  insert into public.organization_members (organization_id, user_id, role, display_name)
  values (new_org, new.id, 'owner', display);
  return new;
end;
$$;

-- ── 3. Lectura de Compras y Jefe de planta (sin importes prohibidos) ──

/**
 * Compras: proyectos (sin precio de venta, presupuesto base ni avance económico), su lista de materiales
 * con costo de compra, compras, consumos, stock, pedidos y precios de materiales.
 * Nunca precio de venta, rentabilidad ni valor de la mano de obra.
 */
create or replace function public.compras_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me record;
begin
  select m.organization_id, m.display_name, o.name as org_name into me
  from public.organization_members m join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid()) and m.role = 'compras' and m.deactivated_at is null
  order by m.created_at limit 1;
  if me.organization_id is null then
    if exists (select 1 from public.organization_members m where m.user_id = (select auth.uid()) and m.role = 'compras') then
      return jsonb_build_object('status', 'inactive');
    end if;
    raise exception 'Tu usuario no es de Compras.' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'status', 'active',
    'organization_id', me.organization_id,
    'organization_name', me.org_name,
    'display_name', me.display_name,
    'projects', coalesce((
      select jsonb_agg(to_jsonb(p) - 'sales_price' - 'baseline' - 'progress_percent' order by p.created_at desc)
      from public.projects p where p.organization_id = me.organization_id), '[]'::jsonb),
    'budget_lines', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.project_id, b.position)
      from public.budget_lines b where b.organization_id = me.organization_id and b.category = 'materials'), '[]'::jsonb),
    'purchase_entries', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.project_id, x.position)
      from public.purchase_entries x where x.organization_id = me.organization_id), '[]'::jsonb),
    'material_usages', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.project_id, x.position)
      from public.material_usages x where x.organization_id = me.organization_id), '[]'::jsonb),
    'stock_lots', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.stock_lots l where l.organization_id = me.organization_id), '[]'::jsonb),
    'stock_movements', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.position)
      from public.stock_movements s where s.organization_id = me.organization_id), '[]'::jsonb),
    'material_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.material_requests r where r.organization_id = me.organization_id), '[]'::jsonb),
    'price_history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.valid_from, h.created_at)
      from public.price_history h where h.organization_id = me.organization_id and h.kind = 'material_price'), '[]'::jsonb)
  );
end;
$$;

/**
 * Jefe de planta: proyectos sin importes, operarios sin costo por hora, horas cargadas sin valor,
 * muebles, bitácora y pedidos. Ningún costo, precio ni rentabilidad.
 */
create or replace function public.planta_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me record;
begin
  select m.organization_id, m.display_name, o.name as org_name into me
  from public.organization_members m join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid()) and m.role = 'jefe_planta' and m.deactivated_at is null
  order by m.created_at limit 1;
  if me.organization_id is null then
    if exists (select 1 from public.organization_members m where m.user_id = (select auth.uid()) and m.role = 'jefe_planta') then
      return jsonb_build_object('status', 'inactive');
    end if;
    raise exception 'Tu usuario no es Jefe de planta.' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'status', 'active',
    'organization_id', me.organization_id,
    'organization_name', me.org_name,
    'display_name', me.display_name,
    'projects', coalesce((
      select jsonb_agg(to_jsonb(p) - 'sales_price' - 'baseline' - 'progress_percent' order by p.created_at desc)
      from public.projects p where p.organization_id = me.organization_id), '[]'::jsonb),
    'operators', coalesce((
      select jsonb_agg(to_jsonb(o) - 'hourly_cost' - 'pin_hash' order by o.position)
      from public.operators o where o.organization_id = me.organization_id), '[]'::jsonb),
    'actual_entries', coalesce((
      select jsonb_agg((to_jsonb(a) - 'amount' - 'labor') || jsonb_build_object('labor', coalesce(a.labor, '{}'::jsonb) - 'hourlyCost')
        order by a.project_id, a.position)
      from public.actual_entries a where a.organization_id = me.organization_id and a.type = 'labor'), '[]'::jsonb),
    'project_items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.position)
      from public.project_items i where i.organization_id = me.organization_id), '[]'::jsonb),
    'stage_logs', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.position)
      from public.stage_logs s where s.organization_id = me.organization_id), '[]'::jsonb),
    'material_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.material_requests r where r.organization_id = me.organization_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.compras_workspace() from public, anon;
revoke all on function public.planta_workspace() from public, anon;
grant execute on function public.compras_workspace() to authenticated;
grant execute on function public.planta_workspace() to authenticated;

-- ── 4. Precios con vigencia (el pasado no se modifica) ───────

create table if not exists public.price_history (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('hour_rate', 'overtime_multiplier', 'operator_cost', 'material_price')),
  -- Tipo de hora (labor/design/admin), 'default' (multiplicador), id del operario o id del material.
  subject_id text not null,
  value numeric not null check (value > 0),
  valid_from date not null,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  primary key (organization_id, id)
);
create index if not exists price_history_subject_idx on public.price_history (organization_id, kind, subject_id, valid_from);

alter table public.price_history enable row level security;
revoke all on public.price_history from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'price_history' and policyname = 'managers read price history') then
    create policy "managers read price history" on public.price_history for select to authenticated
      using ((select private.is_org_manager(organization_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'price_history' and policyname = 'managers add price history') then
    create policy "managers add price history" on public.price_history for insert to authenticated
      with check ((select private.is_org_manager(organization_id)));
  end if;
end $$;

/** El historial solo crece: un cambio es un registro nuevo, nunca se edita ni se borra uno anterior. */
create or replace function private.guard_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.bulk_loading() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return old; -- se borra la empresa
  end if;
  if tg_op = 'DELETE' and tg_table_name = 'value_corrections' then
    if not exists (select 1 from public.projects p where p.organization_id = old.organization_id and p.id = (to_jsonb(old) ->> 'project_id')) then
      return old; -- se borra el proyecto
    end if;
  end if;
  raise exception 'Es un historial: no se edita ni se borra. Para cambiar un valor cargá uno nuevo.' using errcode = 'check_violation';
end;
$$;

create or replace trigger guard_price_history before update or delete on public.price_history
  for each row execute function private.guard_append_only();

/**
 * Valor vigente en una fecha: el último con "vigente desde" ≤ fecha (si hay dos el mismo día, el último cargado).
 * Antes del primer registro vale el primero. Sin registros: null (se usa el valor cargado de siempre).
 * Misma regla que rateAt en lib/price-history.ts.
 */
create or replace function private.value_at(org uuid, p_kind text, p_subject text, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select h.value from public.price_history h
     where h.organization_id = org and h.kind = p_kind and h.subject_id = p_subject and h.valid_from <= p_date
     order by h.valid_from desc, h.created_at desc, h.id desc limit 1),
    (select h.value from public.price_history h
     where h.organization_id = org and h.kind = p_kind and h.subject_id = p_subject
     order by h.valid_from asc, h.created_at desc, h.id desc limit 1)
  );
$$;

-- Cómo se valúan las horas reales: con el costo de cada operario (como hasta ahora) o con la tarifa general
-- de Mano de obra. Pendiente de confirmar con el cliente: el modelo admite las dos.
alter table public.cost_settings add column if not exists labor_valuation text not null default 'operator';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_settings_labor_valuation_check') then
    alter table public.cost_settings
      add constraint cost_settings_labor_valuation_check check (labor_valuation in ('operator', 'general'));
  end if;
end $$;

/** Costo de una hora real de un operario en una fecha, según cómo valúa la empresa (vigente ese día). */
create or replace function private.labor_cost_at(org uuid, p_operator text, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select c.labor_valuation from public.cost_settings c where c.organization_id = org), 'operator') = 'general'
      then coalesce(
        private.value_at(org, 'hour_rate', 'labor', p_date),
        (select r.hourly_rate from public.hour_rates r where r.organization_id = org and r.id = 'labor'),
        (select o.hourly_cost from public.operators o where o.organization_id = org and o.id = p_operator))
    else coalesce(
      private.value_at(org, 'operator_cost', p_operator, p_date),
      (select o.hourly_cost from public.operators o where o.organization_id = org and o.id = p_operator))
  end;
$$;

revoke all on function private.value_at(uuid, text, text, date) from public;
revoke all on function private.labor_cost_at(uuid, text, date) from public;
grant execute on function private.value_at(uuid, text, text, date) to authenticated;
grant execute on function private.labor_cost_at(uuid, text, date) to authenticated;

-- Datos existentes: cada valor actual queda vigente desde que se creó (nada cambia de valor).
insert into public.price_history (organization_id, id, kind, subject_id, value, valid_from, created_at, created_by)
select r.organization_id, 'ph-hr-' || r.id, 'hour_rate', r.id, r.hourly_rate, o.created_at::date, o.created_at, 'Migración Lote 5A'
from public.hour_rates r join public.organizations o on o.id = r.organization_id
on conflict (organization_id, id) do nothing;

insert into public.price_history (organization_id, id, kind, subject_id, value, valid_from, created_at, created_by)
select c.organization_id, 'ph-ot-default', 'overtime_multiplier', 'default', c.overtime_multiplier, o.created_at::date, o.created_at, 'Migración Lote 5A'
from public.cost_settings c join public.organizations o on o.id = c.organization_id
on conflict (organization_id, id) do nothing;

insert into public.price_history (organization_id, id, kind, subject_id, value, valid_from, created_at, created_by)
select op.organization_id, 'ph-op-' || op.id, 'operator_cost', op.id, op.hourly_cost, op.created_at::date, op.created_at, 'Migración Lote 5A'
from public.operators op
on conflict (organization_id, id) do nothing;

-- Horas de un operario: costo vigente ESE día (antes: el costo por hora actual del operario).
create or replace function public.taller_log_hours(p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
  proj public.projects;
  v_hours numeric := (p ->> 'hours')::numeric;
  v_date date := (p ->> 'date')::date;
  v_stage text;
  v_work text := coalesce(nullif(trim(p ->> 'work_type'), ''), 'Trabajo');
  v_rate numeric;
  v_day numeric;
  v_id text := private.safe_id(p ->> 'id', 'act');
begin
  select * into me from private.taller_me();
  if me.operator_id is null then
    raise exception 'Tu usuario no está habilitado para cargar en Taller (no está vinculado o fue dado de baja).'
      using errcode = 'insufficient_privilege';
  end if;
  proj := private.taller_project(me.organization_id, p ->> 'project_id');
  v_stage := coalesce(nullif(p ->> 'stage', ''), proj.status);

  if v_hours is null or v_hours <= 0 then
    raise exception 'Indicá las horas trabajadas.' using errcode = 'check_violation';
  end if;
  if v_date is null or v_date > private.today_ar() then
    raise exception 'No se pueden cargar horas de una fecha futura.' using errcode = 'check_violation';
  end if;
  if v_stage not in ('purchasing', 'production', 'installation') or private.stage_rank(v_stage) > private.stage_rank(proj.status) then
    raise exception 'Etapa inválida para cargar horas.' using errcode = 'check_violation';
  end if;
  if nullif(p ->> 'item_id', '') is not null and not exists (
    select 1 from public.project_items i where i.organization_id = me.organization_id and i.project_id = proj.id and i.id = p ->> 'item_id'
  ) then
    raise exception 'El mueble elegido no existe en este proyecto.' using errcode = 'check_violation';
  end if;
  select coalesce(sum((a.labor ->> 'hours')::numeric), 0) into v_day
  from public.actual_entries a
  where a.organization_id = me.organization_id and a.operator_id = me.operator_id and a.type = 'labor' and a.date = v_date;
  if v_day + v_hours > 16 and not coalesce((p ->> 'confirm_high')::boolean, false) then
    raise exception 'Ese día quedarían % h cargadas (más de 16). Confirmá para guardarlas.', private.fmt_num(v_day + v_hours)
      using errcode = 'check_violation';
  end if;

  v_rate := private.labor_cost_at(me.organization_id, me.operator_id, v_date);

  insert into public.actual_entries (
    organization_id, id, project_id, position, date, type, category, description, amount,
    labor, operator_id, stage, item_id, notes, created_by, created_at
  ) values (
    me.organization_id, v_id, proj.id, private.next_position('actual_entries', me.organization_id, proj.id), v_date,
    'labor', 'labor', v_work || ' — ' || me.operator_name, round(v_hours * v_rate, 2),
    jsonb_build_object('role', v_work, 'workerName', me.operator_name, 'hours', v_hours, 'hourlyCost', v_rate),
    me.operator_id, v_stage, nullif(p ->> 'item_id', ''), nullif(trim(p ->> 'notes'), ''), me.operator_name, now()
  );
  insert into public.activity_events (organization_id, id, project_id, position, at, actor, kind, message)
  values (
    me.organization_id, private.safe_id(null, 'act'), proj.id, private.next_position('activity_events', me.organization_id, proj.id),
    now(), me.operator_name, 'cost',
    me.operator_name || ' registró ' || private.fmt_num(v_hours) || ' horas de ' || v_work || ' (' || me.operator_name || ').'
  );
  update public.projects set updated_at = now() where organization_id = me.organization_id and id = proj.id;
  return v_id;
end;
$$;

-- ── 5. Valores congelados y correcciones auditadas ───────────

/** true solo dentro de admin_correct_value(): la única vía para cambiar un valor congelado. */
create or replace function private.correcting()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('blerp.correction', true), '') = 'on';
$$;
revoke all on function private.correcting() from public;
grant execute on function private.correcting() to authenticated;

create table if not exists public.value_corrections (
  organization_id uuid not null,
  id text not null,
  project_id text not null,
  target text not null check (target in ('sales_price', 'budget_line')),
  line_id text,
  field text not null check (field in ('sales_price', 'quantity', 'unit_cost')),
  description text not null default '',
  old_value numeric,
  new_value numeric not null,
  reason text not null check (length(trim(reason)) >= 3),
  corrected_by text not null,
  corrected_by_user uuid references auth.users (id) on delete set null,
  corrected_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, project_id) references public.projects (organization_id, id) on delete cascade
);
create index if not exists value_corrections_project_idx on public.value_corrections (organization_id, project_id);

alter table public.value_corrections enable row level security;
revoke all on public.value_corrections from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'value_corrections' and policyname = 'managers read corrections') then
    create policy "managers read corrections" on public.value_corrections for select to authenticated
      using ((select private.is_org_manager(organization_id)));
  end if;
end $$;

create or replace trigger guard_value_corrections before update or delete on public.value_corrections
  for each row execute function private.guard_append_only();

-- Proyecto: además de lo del Lote 2, desde Aprobado el precio de venta queda congelado.
create or replace function private.guard_project_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.rules_off(new.organization_id) then return new; end if;
  if private.correcting() then
    -- Corrección auditada: solo puede cambiar el precio de venta.
    if (to_jsonb(old) - 'updated_at' - 'sales_price') is distinct from (to_jsonb(new) - 'updated_at' - 'sales_price') then
      raise exception 'Una corrección solo cambia el valor corregido.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.is_closed then
    if (to_jsonb(old) - 'updated_at') is distinct from (to_jsonb(new) - 'updated_at') then
      raise exception 'El proyecto está cerrado: no admite cambios.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.sales_price is distinct from old.sales_price and private.stage_rank(old.status) >= private.stage_rank('approved') then
    raise exception 'El precio de venta quedó congelado al aprobar el proyecto: corregilo con un registro (Corregir).'
      using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'completed' then
      if not new.is_closed then
        raise exception 'Para finalizar un proyecto hay que cerrarlo.' using errcode = 'check_violation';
      end if;
    elsif not (
      private.stage_rank(new.status) = private.stage_rank(old.status) + 1
      or private.stage_rank(new.status) < private.stage_rank(old.status)
    ) then
      raise exception 'Las etapas se avanzan de a una (de % no se puede pasar a %).', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  if new.is_closed and new.status <> 'completed' then
    raise exception 'Un proyecto cerrado tiene que estar Finalizado.' using errcode = 'check_violation';
  end if;
  -- Congelado = misma captura y mismo total (las categorías de las líneas pueden venir normalizadas).
  if old.baseline is not null and (
    new.baseline is null
    or (new.baseline -> 'capturedAt') is distinct from (old.baseline -> 'capturedAt')
    or (new.baseline -> 'budgetTotal') is distinct from (old.baseline -> 'budgetTotal')
    or jsonb_array_length(coalesce(new.baseline -> 'lines', '[]'::jsonb)) <> jsonb_array_length(coalesce(old.baseline -> 'lines', '[]'::jsonb))
  ) then
    raise exception 'El presupuesto base ya está congelado: no se puede reemplazar.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Costo presupuestado: se edita solo en Cotización (desde Aprobado queda congelado; antes: también en Aprobado).
create or replace function private.guard_budget_lines()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st text;
  pid text := coalesce(new.project_id, old.project_id);
  org uuid := coalesce(new.organization_id, old.organization_id);
begin
  if private.rules_off(org) then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'position' - 'category') = (to_jsonb(new) - 'position' - 'category') then return new; end if;
  if tg_op = 'UPDATE' and private.correcting() then
    if (to_jsonb(old) - 'quantity' - 'unit_cost' - 'total') is distinct from (to_jsonb(new) - 'quantity' - 'unit_cost' - 'total') then
      raise exception 'Una corrección solo cambia el valor corregido.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  select p.status into st from public.projects p where p.organization_id = org and p.id = pid;
  if st is null then return coalesce(new, old); end if; -- el proyecto se está borrando
  if st <> 'quotation' then
    raise exception 'El costo presupuestado quedó congelado al aprobar el proyecto: corregilo con un registro (Corregir).'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

/**
 * Corrección de un valor congelado (precio de venta, o cantidad / costo unitario de una línea del costo
 * presupuestado) en un proyecto aprobado o cerrado. Deja registro: quién, cuándo, valor anterior, nuevo y motivo.
 */
create or replace function public.admin_correct_value(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_admin_org();
  proj public.projects;
  line public.budget_lines;
  v_target text := p ->> 'target';
  v_field text := p ->> 'field';
  v_line text := nullif(p ->> 'line_id', '');
  v_new numeric := (p ->> 'new_value')::numeric;
  v_reason text := trim(coalesce(p ->> 'reason', ''));
  v_old numeric;
  v_desc text;
  v_actor text;
  v_id text := private.safe_id(p ->> 'id', 'cor');
  v_at timestamptz := now();
  v_act text := private.safe_id(null, 'act');
  v_msg text;
begin
  select * into proj from public.projects where organization_id = org and id = p ->> 'project_id';
  if not found then
    raise exception 'Proyecto no encontrado.' using errcode = 'no_data_found';
  end if;
  if not (proj.is_closed or private.stage_rank(proj.status) >= private.stage_rank('approved')) then
    raise exception 'Este proyecto está en Cotización: se edita directamente, sin corrección.' using errcode = 'check_violation';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Escribí el motivo de la corrección.' using errcode = 'check_violation';
  end if;
  select m.display_name into v_actor from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());

  perform set_config('blerp.correction', 'on', true);
  if v_target = 'sales_price' and v_field = 'sales_price' then
    if v_new is null or v_new <= 0 then
      raise exception 'El precio de venta tiene que ser mayor a cero.' using errcode = 'check_violation';
    end if;
    v_old := proj.sales_price;
    v_desc := 'Precio de venta';
    update public.projects set sales_price = v_new, updated_at = v_at where organization_id = org and id = proj.id;
  elsif v_target = 'budget_line' and v_field in ('quantity', 'unit_cost') then
    select * into line from public.budget_lines where organization_id = org and project_id = proj.id and id = v_line;
    if not found then
      raise exception 'Línea del costo presupuestado no encontrada.' using errcode = 'no_data_found';
    end if;
    if v_new is null or v_new < 0 or (v_field = 'quantity' and (v_new = 0 or line.quantity is null)) then
      raise exception 'Valor inválido para la corrección.' using errcode = 'check_violation';
    end if;
    v_desc := line.description;
    if v_field = 'quantity' then
      v_old := line.quantity;
      update public.budget_lines set quantity = v_new, total = round(v_new * line.unit_cost, 2)
      where organization_id = org and id = line.id;
    else
      v_old := line.unit_cost;
      update public.budget_lines
      set unit_cost = v_new, total = case when line.quantity is null then round(v_new, 2) else round(line.quantity * v_new, 2) end
      where organization_id = org and id = line.id;
    end if;
  else
    raise exception 'Corrección inválida.' using errcode = 'check_violation';
  end if;
  perform set_config('blerp.correction', 'off', true);

  insert into public.value_corrections (
    organization_id, id, project_id, target, line_id, field, description, old_value, new_value, reason,
    corrected_by, corrected_by_user, corrected_at
  ) values (
    org, v_id, proj.id, v_target, v_line, v_field, v_desc, v_old, v_new, v_reason,
    coalesce(v_actor, ''), (select auth.uid()), v_at
  );
  v_msg := 'Corrección de ' || lower(v_desc) || ': ' || coalesce(private.fmt_num(v_old), '—') || ' → ' || private.fmt_num(v_new) || '. Motivo: ' || v_reason;
  insert into public.activity_events (organization_id, id, project_id, position, at, actor, kind, message)
  values (org, v_act, proj.id, private.next_position('activity_events', org, proj.id), v_at, coalesce(v_actor, ''), 'budget', v_msg);
  return jsonb_build_object(
    'id', v_id, 'corrected_at', v_at, 'old_value', v_old, 'corrected_by', coalesce(v_actor, ''),
    'description', v_desc, 'activity_id', v_act, 'message', v_msg
  );
end;
$$;

revoke all on function public.admin_correct_value(jsonb) from public, anon;
grant execute on function public.admin_correct_value(jsonb) to authenticated;
