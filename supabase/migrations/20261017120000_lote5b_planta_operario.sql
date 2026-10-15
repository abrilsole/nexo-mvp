-- ─────────────────────────────────────────────────────────────
-- Lote 5B · Planta y operario.
--
-- 1. work_assignments: el Jefe de planta asigna operario × proyecto × rubro × día con horas previstas.
--    Sin importes. La leen Administrativo y Jefe de planta (RLS); el Operario recibe las suyas en
--    taller_workspace(). Se escriben solo con planta_save_assignment / planta_remove_assignment
--    (Administrativo o Jefe de planta). Quitar = removed_at (no se borra la fila).
-- 2. Las horas se cargan por RUBRO del proyecto: actual_entries.rubro y assignment_id.
-- 3. budget_lines.workers: cuántos operarios pidió el Cotizador para el rubro (líneas nuevas).
-- 4. planta_workspace() suma asignaciones, mano de obra estimada por rubro (horas y operarios, sin costo),
--    jornada y umbrales de alertas. taller_workspace() suma la jornada, sus asignaciones y los rubros de sus
--    proyectos (solo el nombre del rubro). taller_log_hours guarda rubro y asignación; ya no pide
--    confirmar por encima de 16 h (el tope de 24 h por persona y día sigue en la base).
--
-- Sin DROP ni DELETE: ADD COLUMN / CREATE ... IF NOT EXISTS / CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────

alter table public.budget_lines add column if not exists workers integer;
alter table public.actual_entries add column if not exists rubro text;
alter table public.actual_entries add column if not exists assignment_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'budget_lines_workers_check') then
    alter table public.budget_lines add constraint budget_lines_workers_check check (workers is null or workers >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'actual_entries_rubro_check') then
    alter table public.actual_entries add constraint actual_entries_rubro_check check (rubro is null or rubro in (
      'carpinteria_madera', 'carpinteria_metalica', 'plasticos', 'vidrios', 'instalacion_electrica', 'pintura',
      'herrajes', 'graficas', 'insumos', 'transporte', 'embalaje', 'montaje', 'imprevistos'
    ));
  end if;
end $$;

-- ── Asignaciones ─────────────────────────────────────────────

create table if not exists public.work_assignments (
  organization_id uuid not null,
  id text not null,
  project_id text not null,
  rubro text not null check (rubro in (
    'carpinteria_madera', 'carpinteria_metalica', 'plasticos', 'vidrios', 'instalacion_electrica', 'pintura',
    'herrajes', 'graficas', 'insumos', 'transporte', 'embalaje', 'montaje', 'imprevistos'
  )),
  operator_id text not null,
  date date not null,
  planned_hours numeric not null check (planned_hours > 0 and planned_hours <= 24),
  notes text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (organization_id, id),
  foreign key (organization_id, project_id) references public.projects (organization_id, id) on delete cascade
);
create index if not exists work_assignments_day_idx on public.work_assignments (organization_id, date, operator_id);

alter table public.work_assignments enable row level security;
revoke all on public.work_assignments from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_assignments' and policyname = 'plant reads assignments') then
    create policy "plant reads assignments" on public.work_assignments for select to authenticated
      using ((select private.is_org_manager(organization_id)) or (select private.is_staff(organization_id, 'jefe_planta')));
  end if;
end $$;

/** Empresa donde el usuario es Administrativo o Jefe de planta activo (los que asignan). Lanza si no lo es. */
create or replace function private.my_plan_org()
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
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'member', 'jefe_planta') and m.deactivated_at is null
  order by m.created_at
  limit 1;
  if org is null then
    raise exception 'Solo el Jefe de planta o un usuario Administrativo asignan trabajo.' using errcode = 'insufficient_privilege';
  end if;
  return org;
end;
$$;

/** Línea de mano de obra sin importes: rubro, horas estimadas y operarios (para planta y operario). */
create or replace function private.labor_line_json(b public.budget_lines)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'project_id', b.project_id, 'position', b.position, 'category', b.category, 'rubro', b.rubro,
    'description', b.description, 'quantity', b.quantity, 'unit', b.unit, 'hour_type', b.hour_type, 'workers', b.workers
  );
$$;

revoke all on function private.my_plan_org() from public;
revoke all on function private.labor_line_json(public.budget_lines) from public;
grant execute on function private.my_plan_org() to authenticated;
grant execute on function private.labor_line_json(public.budget_lines) to authenticated;

/**
 * Crea o modifica una asignación. Valida proyecto (Aprobado a Instalación), operario activo, rubro, día y horas.
 * El operario queda en el equipo del proyecto (así lo ve en "Mi día" y puede cargar horas).
 */
create or replace function public.planta_save_assignment(p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_plan_org();
  proj public.projects;
  v_id text := private.safe_id(p ->> 'id', 'asg');
  v_operator text := p ->> 'operator_id';
  v_hours numeric := (p ->> 'planned_hours')::numeric;
  v_date date := (p ->> 'date')::date;
  v_actor text;
begin
  select * into proj from public.projects where organization_id = org and id = p ->> 'project_id';
  if not found then
    raise exception 'Proyecto no encontrado.' using errcode = 'no_data_found';
  end if;
  if proj.is_closed or proj.status not in ('approved', 'purchasing', 'production', 'installation') then
    raise exception 'Solo se asignan proyectos entre Aprobado e Instalación.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.operators o where o.organization_id = org and o.id = v_operator and o.active and o.deactivated_at is null
  ) then
    raise exception 'Elegí un operario activo.' using errcode = 'check_violation';
  end if;
  if v_hours is null or v_hours <= 0 or v_hours > 24 then
    raise exception 'Las horas previstas tienen que estar entre 0 y 24.' using errcode = 'check_violation';
  end if;
  if v_date is null then
    raise exception 'Elegí el día.' using errcode = 'check_violation';
  end if;
  select m.display_name into v_actor from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());

  insert into public.work_assignments (organization_id, id, project_id, rubro, operator_id, date, planned_hours, notes, created_by)
  values (org, v_id, proj.id, p ->> 'rubro', v_operator, v_date, v_hours, nullif(trim(p ->> 'notes'), ''), coalesce(v_actor, ''))
  on conflict (organization_id, id) do update
    set project_id = excluded.project_id, rubro = excluded.rubro, operator_id = excluded.operator_id, date = excluded.date,
        planned_hours = excluded.planned_hours, notes = excluded.notes, updated_at = now(), removed_at = null;

  if not (v_operator = any (proj.assigned_operator_ids)) then
    update public.projects set assigned_operator_ids = array_append(assigned_operator_ids, v_operator), updated_at = now()
    where organization_id = org and id = proj.id;
  end if;
  return v_id;
end;
$$;

/** Quita una asignación (queda marcada con removed_at; no se borra la fila). */
create or replace function public.planta_remove_assignment(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_plan_org();
begin
  update public.work_assignments set removed_at = now(), updated_at = now()
  where organization_id = org and id = p_id and removed_at is null;
end;
$$;

revoke all on function public.planta_save_assignment(jsonb) from public, anon;
revoke all on function public.planta_remove_assignment(text) from public, anon;
grant execute on function public.planta_save_assignment(jsonb) to authenticated;
grant execute on function public.planta_remove_assignment(text) to authenticated;

-- ── Lectura del Jefe de planta y del Operario ────────────────

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
      from public.material_requests r where r.organization_id = me.organization_id), '[]'::jsonb),
    -- Lote 5B: asignaciones, mano de obra estimada por rubro (horas y operarios, sin costo), jornada y umbrales de alertas.
    'assignments', coalesce((
      select jsonb_agg(to_jsonb(w) - 'removed_at' order by w.date, w.created_at)
      from public.work_assignments w where w.organization_id = me.organization_id and w.removed_at is null), '[]'::jsonb),
    'budget_lines', coalesce((
      select jsonb_agg(private.labor_line_json(b) order by b.project_id, b.position)
      from public.budget_lines b where b.organization_id = me.organization_id and b.category = 'labor'), '[]'::jsonb),
    'hours_per_day', coalesce((select c.hours_per_day from public.cost_settings c where c.organization_id = me.organization_id), 9.5),
    'alert_settings', (select o.alert_settings from public.organizations o where o.id = me.organization_id)
  );
end;
$$;

create or replace function public.taller_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me record;
  pids text[];
  lot_ids text[];
  org_name text;
begin
  select * into me from private.taller_me();
  if me.operator_id is null then
    if exists (select 1 from public.organization_members m where m.user_id = (select auth.uid()) and m.role = 'operator') then
      return jsonb_build_object('status', 'inactive');
    end if;
    raise exception 'Tu usuario no es operario de ninguna empresa.' using errcode = 'insufficient_privilege';
  end if;

  select o.name into org_name from public.organizations o where o.id = me.organization_id;
  select coalesce(array_agg(p.id), '{}') into pids
  from public.projects p
  where p.organization_id = me.organization_id
    and not p.is_closed
    and p.status in ('purchasing', 'production', 'installation')
    and me.operator_id = any (p.assigned_operator_ids);

  select coalesce(array_agg(distinct m.lot_id), '{}') into lot_ids
  from public.stock_movements m
  where m.organization_id = me.organization_id
    and ((m.from_place ->> 'projectId') = any (pids) or (m.to_place ->> 'projectId') = any (pids));

  return jsonb_build_object(
    'status', 'active',
    'organization_id', me.organization_id,
    'organization_name', org_name,
    'operator', jsonb_build_object(
      'id', me.operator_id, 'name', me.operator_name, 'role', me.operator_role, 'hourly_cost', 0,
      'active', true, 'user_id', (select auth.uid()), 'email', me.operator_email, 'created_at', me.created_at, 'position', 0
    ),
    'projects', coalesce((
      select jsonb_agg(
        (to_jsonb(p) - 'sales_price' - 'baseline' - 'progress_percent')
        || jsonb_build_object('sales_price', 0, 'baseline', null, 'progress_percent', 0)
        order by p.created_at desc)
      from public.projects p where p.organization_id = me.organization_id and p.id = any (pids)), '[]'::jsonb),
    'project_items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.position)
      from public.project_items i where i.organization_id = me.organization_id and i.project_id = any (pids)), '[]'::jsonb),
    'stage_logs', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.position)
      from public.stage_logs s where s.organization_id = me.organization_id and s.project_id = any (pids)), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.position)
      from public.attachments a where a.organization_id = me.organization_id and a.project_id = any (pids)), '[]'::jsonb),
    'actual_entries', coalesce((
      select jsonb_agg(
        to_jsonb(a) || jsonb_build_object('amount', 0, 'labor', coalesce(a.labor, '{}'::jsonb) || jsonb_build_object('hourlyCost', 0))
        order by a.position)
      from public.actual_entries a
      where a.organization_id = me.organization_id and a.project_id = any (pids)
        and a.type = 'labor' and a.operator_id = me.operator_id), '[]'::jsonb),
    'stock_lots', coalesce((
      select jsonb_agg((to_jsonb(l) - 'supplier') || jsonb_build_object('unit_cost', 0) order by l.created_at, l.id)
      from public.stock_lots l where l.organization_id = me.organization_id and l.id = any (lot_ids)), '[]'::jsonb),
    'stock_movements', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.position)
      from public.stock_movements m
      where m.organization_id = me.organization_id
        and ((m.from_place ->> 'projectId') = any (pids) or (m.to_place ->> 'projectId') = any (pids))), '[]'::jsonb),
    'material_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from public.material_requests r
      where r.organization_id = me.organization_id and r.project_id = any (pids) and r.requested_by = me.operator_name), '[]'::jsonb),
    -- Lote 5B: su jornada (para avisar si se pasa), sus asignaciones (de las últimas dos semanas en adelante) y
    -- los rubros con mano de obra de sus proyectos (solo el rubro: ni horas estimadas ni costos).
    'hours_per_day', coalesce((select c.hours_per_day from public.cost_settings c where c.organization_id = me.organization_id), 9.5),
    'assignments', coalesce((
      select jsonb_agg(to_jsonb(w) - 'removed_at' order by w.date, w.created_at)
      from public.work_assignments w
      where w.organization_id = me.organization_id and w.operator_id = me.operator_id and w.removed_at is null
        and w.project_id = any (pids) and w.date >= private.today_ar() - 14), '[]'::jsonb),
    'project_rubros', coalesce((
      select jsonb_agg(distinct jsonb_build_object('project_id', b.project_id, 'rubro', b.rubro))
      from public.budget_lines b
      where b.organization_id = me.organization_id and b.project_id = any (pids) and b.category = 'labor' and b.rubro is not null), '[]'::jsonb)
  );
end;
$$;

-- ── Carga de horas por rubro ─────────────────────────────────

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
  v_id text := private.safe_id(p ->> 'id', 'act');
  v_rubro text := nullif(p ->> 'rubro', '');
  v_assignment text := nullif(p ->> 'assignment_id', '');
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
  if v_assignment is not null and not exists (
    select 1 from public.work_assignments w
    where w.organization_id = me.organization_id and w.id = v_assignment and w.operator_id = me.operator_id
      and w.project_id = proj.id and w.removed_at is null
  ) then
    raise exception 'Esa asignación no es tuya.' using errcode = 'check_violation';
  end if;
  -- Hasta 24 h por persona y día (lo controla guard_execution_records). Pasar la jornada es solo un aviso en pantalla.

  v_rate := private.labor_cost_at(me.organization_id, me.operator_id, v_date);

  insert into public.actual_entries (
    organization_id, id, project_id, position, date, type, category, description, amount,
    labor, operator_id, stage, item_id, rubro, assignment_id, notes, created_by, created_at
  ) values (
    me.organization_id, v_id, proj.id, private.next_position('actual_entries', me.organization_id, proj.id), v_date,
    'labor', 'labor', v_work || ' — ' || me.operator_name, round(v_hours * v_rate, 2),
    jsonb_build_object('role', v_work, 'workerName', me.operator_name, 'hours', v_hours, 'hourlyCost', v_rate),
    me.operator_id, v_stage, nullif(p ->> 'item_id', ''), v_rubro, v_assignment, nullif(trim(p ->> 'notes'), ''), me.operator_name, now()
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
