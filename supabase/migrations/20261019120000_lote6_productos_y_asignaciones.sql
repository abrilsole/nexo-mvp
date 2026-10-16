-- ─────────────────────────────────────────────────────────────
-- Lote 6 · Fase 1 · Productos, rubros por producto y asignaciones por producto.
--
-- 1. Los productos del proyecto son los ítems que ya existían (project_items: nombre y cantidad).
--    Se les suma:
--      rubros          [{rubro, hours, workers}]: rubros que necesita el producto, horas estimadas
--                      (para toda la cantidad) y cuántos operarios pide cada rubro (sin nombre). Sin importes.
--      completed_units unidades terminadas (las carga SOLO el Jefe de planta o un Administrativo).
-- 2. work_assignments.item_id: toda asignación es producto + rubro + operario + fecha.
-- 3. Toda hora NUEVA se carga contra una asignación (trigger guard_labor_assignment). Las horas que ya
--    existían en la base no se tocan.
-- 4. taller_log_hours toma proyecto, producto y rubro de la asignación (del operario, de ese día).
--    taller_workspace no manda las unidades terminadas ni los rubros sueltos del presupuesto.
-- 5. planta_set_completed_units: contador de unidades terminadas (0..cantidad).
--    planta_load_assignments: carga en bloque de las asignaciones de la demo (Administrativo).
--
-- Sin DROP ni DELETE: ADD COLUMN / CREATE ... IF NOT EXISTS / CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────

alter table public.project_items add column if not exists rubros jsonb not null default '[]'::jsonb;
alter table public.project_items add column if not exists completed_units numeric not null default 0;
alter table public.work_assignments add column if not exists item_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_items_completed_units_check') then
    alter table public.project_items add constraint project_items_completed_units_check
      check (completed_units >= 0 and completed_units <= quantity);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_items_rubros_check') then
    alter table public.project_items add constraint project_items_rubros_check check (jsonb_typeof(rubros) = 'array');
  end if;
end $$;

create index if not exists work_assignments_item_idx on public.work_assignments (organization_id, project_id, item_id, rubro);

/** ¿El producto de ese proyecto tiene ese rubro? */
create or replace function private.item_has_rubro(org uuid, project text, item text, p_rubro text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_items i, jsonb_array_elements(i.rubros) r
    where i.organization_id = org and i.project_id = project and i.id = item and r ->> 'rubro' = p_rubro
  );
$$;

revoke all on function private.item_has_rubro(uuid, text, text, text) from public;
grant execute on function private.item_has_rubro(uuid, text, text, text) to authenticated;

/**
 * Crea o modifica una asignación: producto + rubro + operario + día + horas previstas.
 * Valida proyecto (Aprobado a Instalación), producto del proyecto con ese rubro, operario activo, día y horas.
 * El operario queda en el equipo del proyecto (así lo ve en "Mi día").
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
  v_item text := nullif(p ->> 'item_id', '');
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
  if v_item is null or not private.item_has_rubro(org, proj.id, v_item, p ->> 'rubro') then
    raise exception 'Elegí un producto del proyecto y uno de sus rubros.' using errcode = 'check_violation';
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

  insert into public.work_assignments (organization_id, id, project_id, item_id, rubro, operator_id, date, planned_hours, notes, created_by)
  values (org, v_id, proj.id, v_item, p ->> 'rubro', v_operator, v_date, v_hours, nullif(trim(p ->> 'notes'), ''), coalesce(v_actor, ''))
  on conflict (organization_id, id) do update
    set project_id = excluded.project_id, item_id = excluded.item_id, rubro = excluded.rubro, operator_id = excluded.operator_id,
        date = excluded.date, planned_hours = excluded.planned_hours, notes = excluded.notes, updated_at = now(), removed_at = null;

  if not (v_operator = any (proj.assigned_operator_ids)) then
    update public.projects set assigned_operator_ids = array_append(assigned_operator_ids, v_operator), updated_at = now()
    where organization_id = org and id = proj.id;
  end if;
  return v_id;
end;
$$;

/** Unidades terminadas de un producto: solo Jefe de planta o Administrativo, entre 0 y la cantidad. */
create or replace function public.planta_set_completed_units(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_plan_org();
  v_units numeric := (p ->> 'units')::numeric;
  item public.project_items;
begin
  select * into item from public.project_items i
  where i.organization_id = org and i.project_id = p ->> 'project_id' and i.id = p ->> 'item_id';
  if not found then
    raise exception 'Producto no encontrado.' using errcode = 'no_data_found';
  end if;
  if v_units is null or v_units < 0 or v_units > item.quantity or v_units <> trunc(v_units) then
    raise exception 'Las unidades terminadas van de 0 a %.', private.fmt_num(item.quantity) using errcode = 'check_violation';
  end if;
  update public.project_items set completed_units = v_units where organization_id = org and id = item.id;
  update public.projects set updated_at = now() where organization_id = org and id = item.project_id;
end;
$$;

/**
 * Asignaciones de la demo en un solo paso ("Restaurar datos demo"). Solo Administrativo. Mismas validaciones
 * de forma que planta_save_assignment, sin tocar el equipo del proyecto (lo trae el seed).
 */
create or replace function public.planta_load_assignments(p jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  n integer;
begin
  select m.organization_id into org from public.organization_members m
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'member') and m.deactivated_at is null
  order by m.created_at limit 1;
  if org is null then
    raise exception 'Solo un usuario Administrativo restaura la demo.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.work_assignments (organization_id, id, project_id, item_id, rubro, operator_id, date, planned_hours, notes, created_by, created_at)
  select org, private.safe_id(a ->> 'id', 'asg'), a ->> 'project_id', nullif(a ->> 'item_id', ''), a ->> 'rubro', a ->> 'operator_id',
         (a ->> 'date')::date, (a ->> 'planned_hours')::numeric, nullif(a ->> 'notes', ''), coalesce(a ->> 'created_by', ''),
         coalesce((a ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p -> 'assignments', '[]'::jsonb)) a
  where exists (select 1 from public.projects pr where pr.organization_id = org and pr.id = a ->> 'project_id')
  on conflict (organization_id, id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.planta_save_assignment(jsonb) from public, anon;
revoke all on function public.planta_set_completed_units(jsonb) from public, anon;
revoke all on function public.planta_load_assignments(jsonb) from public, anon;
grant execute on function public.planta_save_assignment(jsonb) to authenticated;
grant execute on function public.planta_set_completed_units(jsonb) to authenticated;
grant execute on function public.planta_load_assignments(jsonb) to authenticated;

-- ── Toda hora nueva se carga contra una asignación ───────────

create or replace function private.guard_labor_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a public.work_assignments;
begin
  if new.type <> 'labor' or private.bulk_loading() then return new; end if;
  -- Un upsert de una fila que ya existía (el Administrativo guarda el proyecto entero) no es una hora nueva.
  if exists (select 1 from public.actual_entries e where e.organization_id = new.organization_id and e.id = new.id) then
    return new;
  end if;
  select * into a from public.work_assignments w
  where w.organization_id = new.organization_id and w.id = new.assignment_id and w.removed_at is null;
  if not found or a.project_id <> new.project_id or a.operator_id is distinct from new.operator_id then
    raise exception 'Las horas se cargan contra una asignación (producto, rubro, operario y día).' using errcode = 'check_violation';
  end if;
  new.rubro := a.rubro;
  new.item_id := coalesce(a.item_id, new.item_id);
  return new;
end;
$$;

create or replace trigger guard_labor_assignment before insert on public.actual_entries
  for each row execute function private.guard_labor_assignment();

/** Horas del operario: SIEMPRE contra una asignación suya. Proyecto, producto, rubro y día salen de la asignación. */
create or replace function public.taller_log_hours(p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
  proj public.projects;
  asg public.work_assignments;
  v_hours numeric := (p ->> 'hours')::numeric;
  v_stage text;
  v_work text;
  v_rate numeric;
  v_id text := private.safe_id(p ->> 'id', 'act');
begin
  select * into me from private.taller_me();
  if me.operator_id is null then
    raise exception 'Tu usuario no está habilitado para cargar en Taller (no está vinculado o fue dado de baja).'
      using errcode = 'insufficient_privilege';
  end if;
  select * into asg from public.work_assignments w
  where w.organization_id = me.organization_id and w.id = nullif(p ->> 'assignment_id', '') and w.removed_at is null;
  if not found or asg.operator_id <> me.operator_id then
    raise exception 'Esa asignación no es tuya.' using errcode = 'check_violation';
  end if;
  proj := private.taller_project(me.organization_id, asg.project_id);
  v_stage := proj.status;

  if v_hours is null or v_hours <= 0 then
    raise exception 'Indicá las horas trabajadas.' using errcode = 'check_violation';
  end if;
  if asg.date > private.today_ar() then
    raise exception 'No se pueden cargar horas de una fecha futura.' using errcode = 'check_violation';
  end if;
  if v_stage not in ('purchasing', 'production', 'installation') then
    raise exception 'Etapa inválida para cargar horas.' using errcode = 'check_violation';
  end if;
  -- Hasta 24 h por persona y día (lo controla guard_execution_records). Pasar la jornada es solo un aviso en pantalla.

  v_work := coalesce(nullif(trim(p ->> 'work_type'), ''), 'Trabajo');
  v_rate := private.labor_cost_at(me.organization_id, me.operator_id, asg.date);

  insert into public.actual_entries (
    organization_id, id, project_id, position, date, type, category, description, amount,
    labor, operator_id, stage, item_id, rubro, assignment_id, notes, created_by, created_at
  ) values (
    me.organization_id, v_id, proj.id, private.next_position('actual_entries', me.organization_id, proj.id), asg.date,
    'labor', 'labor', v_work || ' — ' || me.operator_name, round(v_hours * v_rate, 2),
    jsonb_build_object('role', v_work, 'workerName', me.operator_name, 'hours', v_hours, 'hourlyCost', v_rate),
    me.operator_id, v_stage, asg.item_id, asg.rubro, asg.id, nullif(trim(p ->> 'notes'), ''), me.operator_name, now()
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

/**
 * Lo que Taller necesita, sin plata: sus proyectos, los productos (sin unidades terminadas), bitácora y archivos,
 * sus horas (sin costo), el material asignado (sin costo), sus pedidos, su jornada y sus asignaciones.
 */
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
      select jsonb_agg((to_jsonb(i) - 'completed_units') || jsonb_build_object('completed_units', 0) order by i.position)
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
    'hours_per_day', coalesce((select c.hours_per_day from public.cost_settings c where c.organization_id = me.organization_id), 9.5),
    'assignments', coalesce((
      select jsonb_agg(to_jsonb(w) - 'removed_at' order by w.date, w.created_at)
      from public.work_assignments w
      where w.organization_id = me.organization_id and w.operator_id = me.operator_id and w.removed_at is null
        and w.project_id = any (pids) and w.date >= private.today_ar() - 14), '[]'::jsonb)
  );
end;
$$;
