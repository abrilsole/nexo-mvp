-- Guarda el cambio de Gestión (proyectos + registros + stock) dentro de una transacción.
-- SECURITY INVOKER: conserva RLS, los permisos y todos los triggers existentes.
BEGIN;
create or replace function public.admin_commit_change(p jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare
 org uuid := private.my_admin_org();
 tbl text; batch jsonb; row_json jsonb; expected jsonb; cols text; updates text; actual_stamp timestamptz;
 allowed text[] := array['operators','projects','project_items','budget_lines','stock_lots','purchase_entries','material_usages','actual_entries','activity_events','stage_logs','attachments','stock_movements','material_requests'];
begin
 -- Serializa las operaciones administrativas de una empresa; la comparación detecta sesiones desactualizadas.
 perform 1 from public.organizations where id=org for update;
 for expected in select * from jsonb_array_elements(coalesce(p->'expected_projects','[]')) loop
   select updated_at into actual_stamp from public.projects where organization_id=org and id=expected->>'id' for update;
   if (expected->>'updated_at') is null then
     if found then raise exception 'El proyecto ya existe. Actualizá los datos.'; end if;
   elsif not found or date_trunc('milliseconds',actual_stamp) is distinct from date_trunc('milliseconds',(expected->>'updated_at')::timestamptz) then
     raise exception 'El proyecto cambió en otra sesión. Actualizá antes de guardar.';
   end if;
 end loop;
 for tbl in select jsonb_object_keys(coalesce(p->'tables','{}')) loop
   if not tbl=any(allowed) then raise exception 'Tabla no permitida.'; end if;
 end loop;
 foreach tbl in array allowed loop
   batch := p->'tables'->tbl;
   if batch is null then continue; end if;
   for row_json in select * from jsonb_array_elements(coalesce(batch->'rows','[]')) loop
     if (row_json->>'organization_id')::uuid is distinct from org then raise exception 'Empresa inválida.'; end if;
     if tbl='projects' then
       select updated_at into actual_stamp from public.projects where organization_id=org and id=row_json->>'id';
       row_json := jsonb_set(row_json,'{updated_at}',to_jsonb(greatest(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',coalesce(actual_stamp,'1970-01-01'::timestamptz))+interval '1 millisecond')));
     end if;
     select string_agg(format('%I',c.column_name),',' order by c.ordinal_position),
            string_agg(format('%1$I=excluded.%1$I',c.column_name),',' order by c.ordinal_position) filter(where c.column_name not in ('organization_id','id'))
     into cols,updates from information_schema.columns c
     where c.table_schema='public' and c.table_name=tbl and row_json ? c.column_name;
     execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict(organization_id,id) do update set %3$s',tbl,cols,updates) using row_json;
   end loop;
   if jsonb_array_length(coalesce(batch->'removed','[]')) > 0 then
     if not tbl=any(array['budget_lines','project_items','attachments','operators']) then raise exception 'El historial no se puede eliminar.'; end if;
     execute format('delete from public.%I where organization_id=$1 and id in (select jsonb_array_elements_text($2))',tbl) using org,batch->'removed';
   end if;
 end loop;
end; $$;
revoke all on function public.admin_commit_change(jsonb) from public,anon;
grant execute on function public.admin_commit_change(jsonb) to authenticated;

-- También protege consumos simultáneos de Taller y movimientos directos por API.
create or replace function private.guard_stock_balance() returns trigger
language plpgsql security definer set search_path='' as $$
declare balance numeric;
begin
 if private.bulk_loading() then return new; end if;
 perform 1 from public.stock_lots where organization_id=new.organization_id and id=new.lot_id for update;
 if not found then raise exception 'El lote no existe en esta empresa.'; end if;
 if exists(select 1 from public.stock_movements where organization_id=new.organization_id and id=new.id) then return new; end if;
 if new.from_place->>'type' in ('warehouse','project') then
   select coalesce(sum(case when to_place=new.from_place then quantity else 0 end),0)
        - coalesce(sum(case when from_place=new.from_place then quantity else 0 end),0)
   into balance from public.stock_movements where organization_id=new.organization_id and lot_id=new.lot_id;
   if new.quantity > balance + .000001 then raise exception 'No alcanza el material disponible. Actualizá los datos.'; end if;
 end if;
 return new;
end; $$;
create trigger guard_stock_balance before insert on public.stock_movements for each row execute function private.guard_stock_balance();
create or replace function public.taller_add_stage_log(p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
  proj public.projects;
  v_text text := trim(coalesce(p ->> 'text', ''));
  v_stage text := p ->> 'stage';
  v_kind text := p ->> 'kind';
  v_id text := private.safe_id(p ->> 'id', 'log');
begin
  select * into me from private.taller_me();
  if me.operator_id is null then
    raise exception 'Tu usuario no está habilitado para cargar en Taller (no está vinculado o fue dado de baja).'
      using errcode = 'insufficient_privilege';
  end if;
  proj := private.taller_project(me.organization_id, p ->> 'project_id');
  if length(v_text) < 3 or length(v_text) > 2000 then
    raise exception 'Contá brevemente qué pasó.' using errcode = 'check_violation';
  end if;
  if v_stage not in ('purchasing', 'production', 'installation') or proj.status not in ('approved','purchasing','production','installation') then
    raise exception 'El proyecto todavía no llegó a esa etapa.' using errcode = 'check_violation';
  end if;
  if v_kind not in ('note', 'incident') then
    raise exception 'Tipo de registro inválido.' using errcode = 'check_violation';
  end if;
  insert into public.stage_logs (organization_id, id, project_id, position, stage, date, kind, text, responsible, item_id, created_by, created_at)
  values (
    me.organization_id, v_id, proj.id, private.next_position('stage_logs', me.organization_id, proj.id), v_stage,
    least(coalesce((p ->> 'date')::date, private.today_ar()), private.today_ar()), v_kind, v_text,
    coalesce(nullif(trim(p ->> 'responsible'), ''), me.operator_name), nullif(p ->> 'item_id', ''), me.operator_name, now()
  );
  insert into public.activity_events (organization_id, id, project_id, position, at, actor, kind, message)
  values (
    me.organization_id, private.safe_id(null, 'act'), proj.id, private.next_position('activity_events', me.organization_id, proj.id),
    now(), me.operator_name, 'stage',
    'Se registró un ' || case v_kind when 'incident' then 'incidente' else 'nota' end || ' en ' ||
      case v_stage when 'purchasing' then 'Compras' when 'production' then 'Producción' else 'Instalación' end || '.'
  );
  update public.projects set updated_at = now() where organization_id = me.organization_id and id = proj.id;
  return v_id;
end;
$$;
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
      (old.status='approved' and new.status='production') or private.stage_rank(new.status) = private.stage_rank(old.status) + 1
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

-- Carga manual: la asignación y sus horas se confirman juntas.
create or replace function public.admin_log_hours_manual(p jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare
 org uuid := private.my_admin_org(); aid text; a public.work_assignments; op public.operators;
 eid text := private.safe_id(p->>'id','act'); h numeric := (p->>'hours')::numeric; st text; actor text;
begin
 if h is null or h<=0 or h>24 then raise exception 'Horas inválidas.'; end if;
 if exists(select 1 from public.actual_entries where organization_id=org and id=eid) then return eid; end if;
 aid := public.planta_save_assignment(p->'assignment');
 select * into a from public.work_assignments where organization_id=org and id=aid;
 select * into op from public.operators where organization_id=org and id=a.operator_id for update;
 select case when status='approved' then 'production' else status end into st from public.projects where organization_id=org and id=a.project_id;
 select display_name into actor from public.organization_members where organization_id=org and user_id=auth.uid();
 insert into public.actual_entries(organization_id,id,project_id,position,date,type,category,description,amount,labor,operator_id,stage,item_id,rubro,assignment_id,notes,created_by)
 values(org,eid,a.project_id,private.next_position('actual_entries',org,a.project_id),a.date,'labor',a.hour_kind,
   'Carga manual — '||op.name,0,jsonb_build_object('hours',h,'hourlyCost',0,'workerName',op.name,'role',a.rubro),
   a.operator_id,st,a.item_id,a.rubro,a.id,p->>'notes',coalesce(actor,'Administrativo'));
 -- value_labor_entry valoriza por fecha en el servidor; guard_execution_records valida toda la jornada.
 update public.projects set updated_at=now() where organization_id=org and id=a.project_id;
 return eid;
end; $$;
revoke all on function public.admin_log_hours_manual(jsonb) from public,anon;
grant execute on function public.admin_log_hours_manual(jsonb) to authenticated;
COMMIT;
