-- ─────────────────────────────────────────────────────────────
-- Lote 6 · Fase 3 · Días laborales por operario (con excepciones por fecha).
--
-- 1. operators.work_days: días de la semana que trabaja (0 = domingo … 6 = sábado). null = lunes a viernes.
-- 2. operator_day_exceptions: excepciones por fecha (ej. "trabaja este sábado 4 h", "no viene el viernes"). Quitar una
--    excepción la marca con removed_at (no se borra).
-- 3. planta_save_schedule(p): el Jefe de planta (o Administrativo) guarda los días y las excepciones de un operario.
-- 4. planta_workspace() suma las excepciones (los días ya vienen en operators).
--
-- La capacidad de cada día (jornada de Configuración, o las horas de la excepción) la calcula lib/schedule.ts.
-- Sin DROP ni DELETE.
-- ─────────────────────────────────────────────────────────────

alter table public.operators add column if not exists work_days smallint[];
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'operators_work_days_check') then
    alter table public.operators add constraint operators_work_days_check
      check (work_days is null or work_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);
  end if;
end $$;

create table if not exists public.operator_day_exceptions (
  organization_id uuid not null,
  operator_id text not null,
  date date not null,
  works boolean not null,
  hours numeric check (hours is null or (hours > 0 and hours <= 24)),
  note text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (organization_id, operator_id, date),
  foreign key (organization_id, operator_id) references public.operators (organization_id, id) on delete cascade
);

alter table public.operator_day_exceptions enable row level security;
revoke all on public.operator_day_exceptions from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'operator_day_exceptions' and policyname = 'plant reads day exceptions') then
    create policy "plant reads day exceptions" on public.operator_day_exceptions for select to authenticated
      using ((select private.is_org_manager(organization_id)) or (select private.is_staff(organization_id, 'jefe_planta')));
  end if;
end $$;

/**
 * Días laborales y excepciones de un operario. `p`: operator_id, work_days (opcional: lista 0..6), exceptions
 * (opcional: [{date, works, hours, note}], se agregan o reemplazan), removed (opcional: fechas cuya excepción se quita).
 */
create or replace function public.planta_save_schedule(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_plan_org();
  v_op text := p ->> 'operator_id';
  v_days smallint[];
  v_actor text;
  x jsonb;
begin
  if not exists (select 1 from public.operators o where o.organization_id = org and o.id = v_op) then
    raise exception 'Operario no encontrado.' using errcode = 'no_data_found';
  end if;
  select coalesce(nullif(trim(m.display_name), ''), 'Jefe de planta') into v_actor from public.organization_members m
  where m.user_id = (select auth.uid()) and m.organization_id = org order by m.created_at limit 1;

  if p ? 'work_days' then
    select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into v_days
    from jsonb_array_elements_text(coalesce(p -> 'work_days', '[]'::jsonb)) d;
    if exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
      raise exception 'Día de la semana inválido.' using errcode = 'check_violation';
    end if;
    update public.operators set work_days = v_days where organization_id = org and id = v_op;
  end if;

  for x in select * from jsonb_array_elements(coalesce(p -> 'exceptions', '[]'::jsonb)) loop
    if (x ->> 'date') is null then
      raise exception 'Indicá la fecha de la excepción.' using errcode = 'check_violation';
    end if;
    if coalesce((x ->> 'works')::boolean, false) and (x ->> 'hours') is not null
       and ((x ->> 'hours')::numeric <= 0 or (x ->> 'hours')::numeric > 24) then
      raise exception 'Las horas de la excepción van de 0 a 24.' using errcode = 'check_violation';
    end if;
    insert into public.operator_day_exceptions (organization_id, operator_id, date, works, hours, note, created_by)
    values (org, v_op, (x ->> 'date')::date, coalesce((x ->> 'works')::boolean, false),
            case when coalesce((x ->> 'works')::boolean, false) then nullif(x ->> 'hours', '')::numeric end,
            nullif(trim(x ->> 'note'), ''), v_actor)
    on conflict (organization_id, operator_id, date) do update
      set works = excluded.works, hours = excluded.hours, note = excluded.note, created_by = excluded.created_by,
          created_at = now(), removed_at = null;
  end loop;

  update public.operator_day_exceptions set removed_at = now()
  where organization_id = org and operator_id = v_op and removed_at is null
    and date in (select d::date from jsonb_array_elements_text(coalesce(p -> 'removed', '[]'::jsonb)) d);
end;
$$;

revoke all on function public.planta_save_schedule(jsonb) from public, anon;
grant execute on function public.planta_save_schedule(jsonb) to authenticated;

/** Jefe de planta: lo del Lote 6 · Fase 2 más las excepciones de días laborales. */
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
