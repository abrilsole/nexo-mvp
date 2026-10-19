-- Permiso comercial independiente. Los accesos actuales se conservan; nuevas cuentas requieren autorización.
BEGIN;
alter table public.organization_members add column if not exists can_view_commercial boolean not null default true;
alter table public.organization_members alter column can_view_commercial set default false;
create or replace function private.is_org_manager(org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=auth.uid()
 and m.deactivated_at is null and (m.role='owner' or (m.role='member' and m.can_view_commercial)));
$$;
-- La vista operativa existente se reutiliza para administración sin acceso comercial.
create or replace function private.is_staff(org uuid,p_role text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m where m.organization_id=org and m.user_id=auth.uid()
 and m.deactivated_at is null and (m.role=p_role or (p_role='jefe_planta' and m.role='member' and not m.can_view_commercial)));
$$;


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
  where m.user_id = (select auth.uid()) and private.is_org_manager(m.organization_id) and m.deactivated_at is null
  order by m.created_at
  limit 1;
  if org is null then
    raise exception 'Solo un usuario Administrativo puede hacer esto.' using errcode = 'insufficient_privilege';
  end if;
  return org;
end;
$$;

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
  where m.user_id = (select auth.uid()) and private.is_staff(m.organization_id, 'jefe_planta') and m.deactivated_at is null
  order by m.created_at limit 1;
  if me.organization_id is null then
    if exists (select 1 from public.organization_members m where m.user_id = (select auth.uid()) and private.is_staff(m.organization_id, 'jefe_planta')) then
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
      select jsonb_agg((to_jsonb(p) - 'sales_price' - 'baseline' - 'progress_percent')
        || jsonb_build_object('materials_state', private.materials_state(me.organization_id, p.id)) order by p.created_at desc)
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
      from public.material_requests r where r.organization_id = me.organization_id), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(to_jsonb(w) - 'removed_at' order by w.date, w.created_at)
      from public.work_assignments w where w.organization_id = me.organization_id and w.removed_at is null), '[]'::jsonb),
    'budget_lines', coalesce((
      select jsonb_agg(private.labor_line_json(b) order by b.project_id, b.position)
      from public.budget_lines b where b.organization_id = me.organization_id and b.category = 'labor'), '[]'::jsonb),
    'day_exceptions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.date, x.operator_id)
      from public.operator_day_exceptions x where x.organization_id = me.organization_id and x.removed_at is null), '[]'::jsonb),
    'hours_per_day', coalesce((select c.hours_per_day from public.cost_settings c where c.organization_id = me.organization_id), 9.5),
    'alert_settings', (select o.alert_settings from public.organizations o where o.id = me.organization_id)
  );
end;
$$;

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
        'role', m.role, 'can_view_commercial', (m.role='owner' or m.can_view_commercial),
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

create or replace function public.reset_workspace(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  t text;
  rows jsonb;
  cols text;
begin
  select m.organization_id into org
  from public.organization_members m
  where m.user_id = (select auth.uid()) and private.is_org_manager(m.organization_id) and m.deactivated_at is null
  order by m.created_at
  limit 1;
  if org is null then
    raise exception 'Solo un usuario Administrativo puede restaurar o vaciar los datos.' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('blerp.bulk', 'on', true);

  delete from public.projects where organization_id = org; -- hijos en cascada
  delete from public.stock_movements where organization_id = org;
  delete from public.stock_lots where organization_id = org;
  delete from public.material_requests where organization_id = org;
  delete from public.reusable_materials where organization_id = org;
  delete from public.resolved_alerts where organization_id = org;
  -- Los operarios vinculados a un usuario (con login) se conservan.
  delete from public.operators where organization_id = org and user_id is null;

  if p_data is not null then
    foreach t in array array[
      'operators', 'projects', 'budget_lines', 'purchase_entries', 'material_usages', 'actual_entries',
      'activity_events', 'project_items', 'stage_logs', 'attachments', 'stock_lots', 'stock_movements',
      'material_requests', 'resolved_alerts'
    ]
    loop
      rows := coalesce(p_data -> t, '[]'::jsonb);
      continue when jsonb_array_length(rows) = 0;
      -- Solo las columnas que vienen en los datos: las demás toman su valor por defecto.
      -- La empresa siempre es la del usuario (nunca la que diga el JSON).
      select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position) into cols
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = t and c.column_name <> 'organization_id'
        and exists (select 1 from jsonb_array_elements(rows) e where e ? c.column_name);
      execute format(
        'insert into public.%1$I (organization_id, %2$s)
           select $2, %2$s from jsonb_populate_recordset(null::public.%1$I, $1)
         on conflict do nothing',
        t, cols
      ) using rows, org;
    end loop;
  end if;

  update public.organizations
  set demo_seeded = true, alert_settings = coalesce(p_data -> 'settings', alert_settings)
  where id = org;

  perform set_config('blerp.bulk', 'off', true);
end;
$$;


create or replace function private.guard_commercial_permission() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.can_view_commercial is distinct from old.can_view_commercial then
   if not exists(select 1 from public.organization_members where organization_id=old.organization_id and user_id=auth.uid() and role='owner' and deactivated_at is null) then
     raise exception 'Solo el titular puede cambiar el permiso comercial.' using errcode='insufficient_privilege';
   end if;
 end if;
 return new;
end; $$;
create trigger guard_commercial_permission before update on public.organization_members for each row execute function private.guard_commercial_permission();
create or replace function public.admin_set_commercial_access(p_user uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.organization_members where user_id=auth.uid() and role='owner' and deactivated_at is null order by created_at limit 1;
 if org is null then raise exception 'Solo el titular puede cambiar el permiso comercial.' using errcode='insufficient_privilege'; end if;
 update public.organization_members set can_view_commercial=p_enabled where organization_id=org and user_id=p_user and role='member';
 if not found then raise exception 'Elegí un usuario Administrativo de tu empresa.'; end if;
end; $$;
revoke all on function public.admin_set_commercial_access(uuid,boolean) from public,anon;
grant execute on function public.admin_set_commercial_access(uuid,boolean) to authenticated;
-- Los helpers de valorización no deben poder consultarse directamente como usuario.
revoke execute on function private.labor_cost_at(uuid,text,date) from authenticated;
revoke execute on function private.value_at(uuid,text,text,date) from authenticated;
COMMIT;
