-- Correcciones auditadas y coherencia de ejecución. No ejecutar sobre producción sin revisión.
BEGIN;

create or replace function private.guard_execution_records()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st text;
  closed boolean;
  day_total numeric;
  hours numeric;
begin
  if private.rules_off(coalesce(new.organization_id, old.organization_id)) then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and private.correcting() then return new; end if;
  if tg_op = 'UPDATE' then
    -- La app vuelve a guardar los registros sin cambios; la categoría puede venir normalizada (Lote 1).
    if (to_jsonb(old) - 'position' - 'category') = (to_jsonb(new) - 'position' - 'category') then return new; end if;
    raise exception 'Los registros no se editan: cargá una corrección.' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.projects p where p.organization_id = old.organization_id and p.id = old.project_id) then
      return old; -- borrado en cascada del proyecto
    end if;
    raise exception 'Los registros no se borran: cargá una corrección.' using errcode = 'check_violation';
  end if;

  select p.status, p.is_closed into st, closed
  from public.projects p where p.organization_id = new.organization_id and p.id = new.project_id;
  if closed then
    raise exception 'El proyecto está cerrado: no admite nuevos registros.' using errcode = 'check_violation';
  end if;
  if st not in ('approved', 'purchasing', 'production', 'installation') then
    raise exception 'El proyecto todavía no está en ejecución: pasalo a Compras para empezar a registrar.' using errcode = 'check_violation';
  end if;
  if new.date > private.today_ar() then
    raise exception 'No se pueden cargar registros con fecha futura.' using errcode = 'check_violation';
  end if;

  if tg_table_name = 'actual_entries' then
    if new.amount < 0 then
      raise exception 'El monto no puede ser negativo.' using errcode = 'check_violation';
    end if;
    if new.type = 'labor' then
      hours := coalesce((new.labor ->> 'hours')::numeric, 0);
      if hours <= 0 then
        raise exception 'Indicá las horas trabajadas.' using errcode = 'check_violation';
      end if;
      if new.operator_id is not null then
        perform 1 from public.operators where organization_id = new.organization_id and id = new.operator_id for update;
        select coalesce(sum((a.labor ->> 'hours')::numeric), 0) into day_total
        from public.actual_entries a
        where a.organization_id = new.organization_id and a.operator_id = new.operator_id
          and a.type = 'labor' and a.date = new.date and a.id <> new.id;
        if day_total + hours > 24 then
          raise exception 'Un día tiene 24 h: con estas serían % h para el mismo operario.', private.fmt_num(day_total + hours)
            using errcode = 'check_violation';
        end if;
      end if;
    end if;
  else
    if new.quantity_consumed < 0 or new.waste_quantity < 0 or new.reusable_leftover_quantity < 0 or new.unit_cost < 0 then
      raise exception 'Las cantidades y el costo no pueden ser negativos.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

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
  perform 1 from public.operators where organization_id = me.organization_id and id = me.operator_id for update;
  if exists (select 1 from public.actual_entries e where e.organization_id = me.organization_id and e.id = v_id) then
    if not exists (select 1 from public.actual_entries e where e.organization_id = me.organization_id and e.id = v_id
      and e.operator_id = me.operator_id and e.assignment_id = asg.id and (e.labor->>'hours')::numeric = v_hours) then
      raise exception 'La solicitud ya existe con otros datos.';
    end if;
    return v_id;
  end if;
  proj := private.taller_project(me.organization_id, asg.project_id);
  v_stage := case when proj.status='approved' then 'production' else proj.status end;

  if v_hours is null or v_hours <= 0 then
    raise exception 'Indicá las horas trabajadas.' using errcode = 'check_violation';
  end if;
  if asg.date > private.today_ar() then
    raise exception 'No se pueden cargar horas de una fecha futura.' using errcode = 'check_violation';
  end if;
  if v_stage not in ('approved', 'purchasing', 'production', 'installation') then
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
    and p.status in ('approved', 'purchasing', 'production', 'installation')
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
  if new.date <> a.date then raise exception 'La fecha debe coincidir con la asignación.'; end if;
  new.rubro := a.rubro;
  new.item_id := coalesce(a.item_id, new.item_id);
  return new;
end;
$$;


create table if not exists public.hours_corrections (
 organization_id uuid not null references public.organizations(id),
 id text not null, entry_id text not null, before_record jsonb not null, allocations jsonb not null,
 reason text not null check(length(trim(reason)) >= 3), corrected_by uuid not null,
 corrected_at timestamptz not null default now(), primary key(organization_id,id)
);
alter table public.hours_corrections enable row level security;
revoke all on public.hours_corrections from public, anon, authenticated;
grant select on public.hours_corrections to authenticated;
create policy "managers read hours audit" on public.hours_corrections for select to authenticated
 using (private.is_org_manager(organization_id));

-- Una corrección conserva el total, la persona y el día. Admite dividir un registro entre asignaciones.
-- El registro original queda íntegro en hours_corrections; los totales operativos leen solo la versión vigente.
create or replace function public.planta_correct_hours(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
 org uuid := private.my_plan_org();
 original public.actual_entries;
 a public.work_assignments;
 target jsonb;
 rate numeric;
 h numeric;
 total numeric;
 first_row boolean := true;
 audit_id text := private.safe_id(p->>'id', 'hc');
 new_id text;
 st text;
begin
 if length(trim(coalesce(p->>'reason',''))) < 3 then raise exception 'Indicá un motivo breve.'; end if;
 if exists(select 1 from public.hours_corrections where organization_id=org and id=audit_id) then return audit_id; end if;
 select * into original from public.actual_entries where organization_id=org and id=p->>'entry_id' and type='labor';
 if not found then raise exception 'Registro no encontrado.'; end if;
 perform 1 from public.operators where organization_id=org and id=original.operator_id for update;
 select * into original from public.actual_entries where organization_id=org and id=p->>'entry_id' for update;
 if (original.labor->>'hours')::numeric <> (p->>'expected_hours')::numeric
    or original.assignment_id is distinct from p->>'expected_assignment_id' then
   raise exception 'El registro cambió. Actualizá y revisalo nuevamente.';
 end if;
 if exists(select 1 from public.projects where organization_id=org and id=original.project_id and is_closed) then
   raise exception 'El proyecto está cerrado.';
 end if;
 if jsonb_typeof(p->'allocations') <> 'array' or jsonb_array_length(p->'allocations') = 0 then raise exception 'Indicá las horas corregidas.'; end if;
 select sum((x->>'hours')::numeric) into total from jsonb_array_elements(p->'allocations') x;
 if total is distinct from (original.labor->>'hours')::numeric then raise exception 'La redistribución debe conservar el total de horas.'; end if;
 -- Validar todo antes de cambiar nada; la función completa es una transacción.
 for target in select * from jsonb_array_elements(p->'allocations') loop
   h := (target->>'hours')::numeric;
   if h is null or h <= 0 or h > 24 then raise exception 'Horas inválidas.'; end if;
   select * into a from public.work_assignments where organization_id=org and id=target->>'assignment_id' and removed_at is null;
   if not found or a.operator_id <> original.operator_id or a.date <> original.date then raise exception 'Elegí asignaciones de la misma persona y fecha.'; end if;
   if not exists(select 1 from public.projects where organization_id=org and id=a.project_id and not is_closed and status in ('approved','purchasing','production','installation')) then raise exception 'El proyecto no admite horas.'; end if;
 end loop;
 insert into public.hours_corrections values(org,audit_id,original.id,to_jsonb(original),p->'allocations',trim(p->>'reason'),auth.uid(),now());
 rate := private.labor_cost_at(org,original.operator_id,original.date);
 if rate is null then raise exception 'Falta la tarifa para esa fecha.'; end if;
 perform set_config('blerp.correction','on',true);
 for target in select * from jsonb_array_elements(p->'allocations') loop
   select * into a from public.work_assignments where organization_id=org and id=target->>'assignment_id';
   select case when status='approved' then 'production' else status end into st from public.projects where organization_id=org and id=a.project_id;
   h := (target->>'hours')::numeric;
   if first_row then
     update public.actual_entries set project_id=a.project_id, assignment_id=a.id, item_id=a.item_id, rubro=a.rubro,
       stage=st, amount=round(h*rate,2), labor=original.labor || jsonb_build_object('hours',h,'hourlyCost',rate)
       where organization_id=org and id=original.id;
     first_row := false;
   else
     new_id := private.safe_id(null,'act');
     insert into public.actual_entries(organization_id,id,project_id,position,date,type,category,description,amount,labor,operator_id,stage,item_id,rubro,assignment_id,notes,created_by,created_at)
     values(org,new_id,a.project_id,private.next_position('actual_entries',org,a.project_id),a.date,'labor',original.category,original.description,
       round(h*rate,2),original.labor || jsonb_build_object('hours',h,'hourlyCost',rate),a.operator_id,st,a.item_id,a.rubro,a.id,
       'Corrección '||audit_id,original.created_by,original.created_at);
   end if;
   update public.projects set updated_at=now() where organization_id=org and id=a.project_id;
 end loop;
 update public.projects set updated_at=now() where organization_id=org and id=original.project_id;
 perform set_config('blerp.correction','off',true);
 return audit_id;
end;
$$;
revoke all on function public.planta_correct_hours(jsonb) from public,anon;
grant execute on function public.planta_correct_hours(jsonb) to authenticated;
create or replace function private.operator_on_project(org uuid, project text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.organization_id = org
      and p.id = project
      and not p.is_closed
      and p.status in ('approved', 'purchasing', 'production', 'installation')
      and private.active_operator_id(org) = any (p.assigned_operator_ids)
  );
$$;

create table if not exists public.hours_reviews (
 organization_id uuid not null references public.organizations(id), review_key text not null,
 reviewed_by uuid not null, reviewed_at timestamptz not null default now(),
 primary key(organization_id,review_key)
);
alter table public.hours_reviews enable row level security;
revoke all on public.hours_reviews from public,anon,authenticated;
grant select on public.hours_reviews to authenticated;
create policy "plant reads reviews" on public.hours_reviews for select to authenticated
 using(private.is_org_manager(organization_id) or private.is_staff(organization_id,'jefe_planta'));
create or replace function public.planta_confirm_hours(p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid := private.my_plan_org();
begin
 if length(p_key) > 20000 then raise exception 'Revisión inválida.'; end if;
 insert into public.hours_reviews(organization_id,review_key,reviewed_by) values(org,p_key,auth.uid())
 on conflict(organization_id,review_key) do nothing;
end; $$;
revoke all on function public.planta_confirm_hours(text) from public,anon;
grant execute on function public.planta_confirm_hours(text) to authenticated;
COMMIT;
