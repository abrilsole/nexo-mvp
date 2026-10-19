BEGIN;
alter table public.work_assignments add column if not exists hour_kind text not null default 'labor' check(hour_kind in ('labor','design','admin'));
-- La tarifa de Diseño/Administración se toma por fecha, sin exponerla a Planta.
create or replace function private.assignment_rate(org uuid, op text, day date, kind text) returns numeric
language sql stable security definer set search_path='' as $$
 select case when kind='labor' then private.labor_cost_at(org,op,day)
 else coalesce(private.value_at(org,'hour_rate',kind,day),(select hourly_rate from public.hour_rates where organization_id=org and id=kind)) end;
$$;
revoke all on function private.assignment_rate(uuid,text,date,text) from public,anon,authenticated;


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

  if exists(select 1 from public.actual_entries where organization_id=org and assignment_id=v_id) and exists(
    select 1 from public.work_assignments w where w.organization_id=org and w.id=v_id and
    (w.project_id <> proj.id or w.item_id is distinct from v_item or w.rubro <> p->>'rubro' or w.operator_id <> v_operator or w.date <> v_date or w.hour_kind <> coalesce(p->>'hour_kind','labor'))
  ) then raise exception 'La asignación ya tiene horas. Corregí los registros desde Revisión de horas.'; end if;
  insert into public.work_assignments (organization_id, id, project_id, item_id, rubro, operator_id, date, planned_hours, hour_kind, notes, created_by)
  values (org, v_id, proj.id, v_item, p ->> 'rubro', v_operator, v_date, v_hours, coalesce(p->>'hour_kind','labor'), nullif(trim(p ->> 'notes'), ''), coalesce(v_actor, ''))
  on conflict (organization_id, id) do update
    set project_id = excluded.project_id, item_id = excluded.item_id, rubro = excluded.rubro, operator_id = excluded.operator_id,
        hour_kind=excluded.hour_kind, date = excluded.date, planned_hours = excluded.planned_hours, notes = excluded.notes, updated_at = now(), removed_at = null;

  if not (v_operator = any (proj.assigned_operator_ids)) then
    update public.projects set assigned_operator_ids = array_append(assigned_operator_ids, v_operator), updated_at = now()
    where organization_id = org and id = proj.id;
  end if;
  return v_id;
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
  v_rate := private.assignment_rate(me.organization_id, me.operator_id, asg.date, asg.hour_kind);

  if v_rate is null then raise exception 'Falta la tarifa para ese tipo de hora.'; end if;
  insert into public.actual_entries (
    organization_id, id, project_id, position, date, type, category, description, amount,
    labor, operator_id, stage, item_id, rubro, assignment_id, notes, created_by, created_at
  ) values (
    me.organization_id, v_id, proj.id, private.next_position('actual_entries', me.organization_id, proj.id), asg.date,
    'labor', asg.hour_kind, v_work || ' — ' || me.operator_name, round(v_hours * v_rate, 2),
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
   rate := private.assignment_rate(org,a.operator_id,a.date,a.hour_kind);
   if rate is null then raise exception 'Falta la tarifa para ese tipo de hora.'; end if;
   if first_row then
     update public.actual_entries set project_id=a.project_id, assignment_id=a.id, item_id=a.item_id, rubro=a.rubro,
       stage=st, category=a.hour_kind, amount=round(h*rate,2), labor=original.labor || jsonb_build_object('hours',h,'hourlyCost',rate)
       where organization_id=org and id=original.id;
     first_row := false;
   else
     new_id := private.safe_id(null,'act');
     insert into public.actual_entries(organization_id,id,project_id,position,date,type,category,description,amount,labor,operator_id,stage,item_id,rubro,assignment_id,notes,created_by,created_at)
     values(org,new_id,a.project_id,private.next_position('actual_entries',org,a.project_id),a.date,'labor',a.hour_kind,original.description,
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


create or replace function private.value_labor_entry() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.work_assignments; rate numeric;
begin
 if new.type <> 'labor' or private.bulk_loading() then return new; end if;
 if exists(select 1 from public.actual_entries where organization_id=new.organization_id and id=new.id) then return new; end if;
 select * into a from public.work_assignments where organization_id=new.organization_id and id=new.assignment_id and removed_at is null;
 if not found then raise exception 'La hora requiere una asignación válida.'; end if;
 rate := private.assignment_rate(new.organization_id,new.operator_id,new.date,a.hour_kind);
 if rate is null then raise exception 'Falta la tarifa para ese tipo de hora.'; end if;
 new.category := a.hour_kind;
 new.labor := new.labor || jsonb_build_object('hourlyCost',rate);
 new.amount := round((new.labor->>'hours')::numeric * rate,2);
 return new;
end; $$;
create trigger value_labor_entry before insert on public.actual_entries for each row execute function private.value_labor_entry();
COMMIT;
