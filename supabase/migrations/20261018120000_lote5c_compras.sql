-- ─────────────────────────────────────────────────────────────
-- Lote 5C · Compras.
--
-- 1. purchase_line_status: estado de cada línea de materiales de un proyecto
--    (pendiente → cotizando → comprado → recibido). Sin importes. La leen Administrativo y Compras;
--    se escribe solo con compras_save().
-- 2. compras_save(p): la única escritura de Compras (también la usa Administrativo para los estados).
--    Compras sigue sin ninguna política sobre las tablas con importes: esta función valida y guarda
--    compras reales (precio pagado, proveedor, fecha), lotes y movimientos de stock, la bitácora de esas
--    acciones, los estados de línea y los pedidos del taller resueltos. Nunca toca precio de venta, mano de obra ni rentabilidad.
-- 3. compras_workspace() suma los estados de línea y los umbrales de alertas.
--
-- Sin DROP ni DELETE: CREATE ... IF NOT EXISTS / CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.purchase_line_status (
  organization_id uuid not null,
  project_id text not null,
  line_id text not null,
  status text not null check (status in ('pending', 'quoting', 'purchased', 'received')),
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_id, line_id),
  foreign key (organization_id, project_id) references public.projects (organization_id, id) on delete cascade
);

alter table public.purchase_line_status enable row level security;
revoke all on public.purchase_line_status from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'purchase_line_status' and policyname = 'buyers read line status') then
    create policy "buyers read line status" on public.purchase_line_status for select to authenticated
      using ((select private.is_org_manager(organization_id)) or (select private.is_staff(organization_id, 'compras')));
  end if;
end $$;

/** Empresa donde el usuario es Administrativo o Compras activo (los que compran). Lanza si no lo es. */
create or replace function private.my_buy_org()
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
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'member', 'compras') and m.deactivated_at is null
  order by m.created_at
  limit 1;
  if org is null then
    raise exception 'Solo Compras o un usuario Administrativo registran compras.' using errcode = 'insufficient_privilege';
  end if;
  return org;
end;
$$;

revoke all on function private.my_buy_org() from public;
grant execute on function private.my_buy_org() to authenticated;

/**
 * Escritura de Compras. `p` trae listas opcionales (todas se validan contra la empresa del usuario):
 *  - purchases: compras reales de un proyecto (cantidad y precio pagado > 0; el total lo calcula la base).
 *  - lots: lotes nuevos de stock (compra, inventario inicial o sobrante de un lote existente).
 *  - lot_locations: cambio de ubicación de un lote (no es un movimiento).
 *  - movements: movimientos de stock (nunca consumo ni desperdicio: eso lo carga el taller).
 *  - activity: bitácora de compras y stock del proyecto.
 *  - line_statuses: estado de una línea de materiales del proyecto.
 *  - request_statuses: pedido de material del taller resuelto o cancelado.
 */
create or replace function public.compras_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_buy_org();
  v_actor text;
  x jsonb;
  proj public.projects;
  parent public.stock_lots;
  v_qty numeric;
  v_cost numeric;
  v_kind text;
  pos integer;
begin
  select coalesce(nullif(trim(m.display_name), ''), 'Compras') into v_actor
  from public.organization_members m
  where m.user_id = (select auth.uid()) and m.organization_id = org
  order by m.created_at limit 1;

  -- Compras reales de un proyecto. La regla de Cotización/cerrado la aplica guard_purchases.
  for x in select * from jsonb_array_elements(coalesce(p -> 'purchases', '[]'::jsonb)) loop
    select * into proj from public.projects where organization_id = org and id = x ->> 'project_id';
    if not found then
      raise exception 'Proyecto no encontrado.' using errcode = 'no_data_found';
    end if;
    v_qty := (x ->> 'quantity')::numeric;
    v_cost := (x ->> 'unit_cost')::numeric;
    if v_qty is null or v_qty <= 0 or v_cost is null or v_cost <= 0 then
      raise exception 'Indicá la cantidad y el precio pagado (mayores a cero).' using errcode = 'check_violation';
    end if;
    if length(trim(coalesce(x ->> 'material_name', ''))) = 0 then
      raise exception 'Indicá el material.' using errcode = 'check_violation';
    end if;
    insert into public.purchase_entries (
      organization_id, id, project_id, position, material_id, material_name, quantity, unit, unit_cost, total,
      supplier, date, notes, created_by, created_at
    ) values (
      org, private.safe_id(x ->> 'id', 'pur'), proj.id, private.next_position('purchase_entries', org, proj.id),
      nullif(x ->> 'material_id', ''), trim(x ->> 'material_name'), v_qty, coalesce(x ->> 'unit', ''), v_cost,
      round(v_qty * v_cost, 2), nullif(trim(x ->> 'supplier'), ''), (x ->> 'date')::date, nullif(trim(x ->> 'notes'), ''),
      v_actor, now()
    );
    update public.projects set updated_at = now() where organization_id = org and id = proj.id;
  end loop;

  -- Lotes nuevos. Un sobrante hereda material y costo de su lote de origen.
  for x in select * from jsonb_array_elements(coalesce(p -> 'lots', '[]'::jsonb)) loop
    v_kind := x ->> 'kind';
    if v_kind not in ('purchase', 'opening', 'leftover') then
      raise exception 'Tipo de lote inválido.' using errcode = 'check_violation';
    end if;
    if x ->> 'origin_project_id' is not null
       and not exists (select 1 from public.projects pr where pr.organization_id = org and pr.id = x ->> 'origin_project_id') then
      raise exception 'Proyecto no encontrado.' using errcode = 'no_data_found';
    end if;
    if x ->> 'purchase_entry_id' is not null
       and not exists (select 1 from public.purchase_entries pe where pe.organization_id = org and pe.id = x ->> 'purchase_entry_id') then
      raise exception 'La compra del lote no existe.' using errcode = 'check_violation';
    end if;
    if v_kind = 'leftover' then
      select * into parent from public.stock_lots s where s.organization_id = org and s.id = x ->> 'parent_lot_id';
      if not found then
        raise exception 'Sobrante sin lote de origen.' using errcode = 'check_violation';
      end if;
      insert into public.stock_lots (
        organization_id, id, material_id, material_name, unit, unit_cost, kind, supplier, origin_project_id,
        origin_project_name, parent_lot_id, location, dims, notes, created_by, created_at
      ) values (
        org, private.safe_id(x ->> 'id', 'lot'), parent.material_id, parent.material_name, parent.unit, parent.unit_cost,
        'leftover', parent.supplier, nullif(x ->> 'origin_project_id', ''), nullif(x ->> 'origin_project_name', ''),
        parent.id, nullif(trim(x ->> 'location'), ''), x -> 'dims', nullif(trim(x ->> 'notes'), ''), v_actor, now()
      );
    else
      v_cost := (x ->> 'unit_cost')::numeric;
      if v_cost is null or v_cost <= 0 then
        raise exception 'Indicá el costo unitario: el material tiene que tener valor.' using errcode = 'check_violation';
      end if;
      if length(trim(coalesce(x ->> 'material_id', ''))) = 0 or length(trim(coalesce(x ->> 'material_name', ''))) = 0 then
        raise exception 'Indicá el material.' using errcode = 'check_violation';
      end if;
      insert into public.stock_lots (
        organization_id, id, material_id, material_name, unit, unit_cost, kind, supplier, purchase_entry_id,
        origin_project_id, origin_project_name, location, notes, created_by, created_at
      ) values (
        org, private.safe_id(x ->> 'id', 'lot'), x ->> 'material_id', trim(x ->> 'material_name'), coalesce(x ->> 'unit', ''),
        v_cost, v_kind, nullif(trim(x ->> 'supplier'), ''), nullif(x ->> 'purchase_entry_id', ''),
        nullif(x ->> 'origin_project_id', ''), nullif(x ->> 'origin_project_name', ''), nullif(trim(x ->> 'location'), ''),
        nullif(trim(x ->> 'notes'), ''), v_actor, now()
      );
    end if;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p -> 'lot_locations', '[]'::jsonb)) loop
    update public.stock_lots set location = nullif(trim(x ->> 'location'), '')
    where organization_id = org and id = x ->> 'id';
  end loop;

  -- Movimientos: el libro de stock solo crece. El consumo y el desperdicio los registra el taller.
  select coalesce(max(s.position) + 1, 0) into pos from public.stock_movements s where s.organization_id = org;
  for x in select * from jsonb_array_elements(coalesce(p -> 'movements', '[]'::jsonb)) loop
    if x ->> 'kind' in ('consume', 'waste') then
      raise exception 'El consumo de material lo registra el taller.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.stock_lots s where s.organization_id = org and s.id = x ->> 'lot_id') then
      raise exception 'Lote no encontrado.' using errcode = 'no_data_found';
    end if;
    if x ->> 'project_id' is not null
       and not exists (select 1 from public.projects pr where pr.organization_id = org and pr.id = x ->> 'project_id') then
      raise exception 'Proyecto no encontrado.' using errcode = 'no_data_found';
    end if;
    insert into public.stock_movements (
      organization_id, id, lot_id, position, kind, quantity, from_place, to_place, date, project_id, item_id,
      into_lot_id, group_id, note, created_by, created_at
    ) values (
      org, private.safe_id(x ->> 'id', 'mov'), x ->> 'lot_id', pos, x ->> 'kind', (x ->> 'quantity')::numeric,
      x -> 'from_place', x -> 'to_place', (x ->> 'date')::date, nullif(x ->> 'project_id', ''), nullif(x ->> 'item_id', ''),
      nullif(x ->> 'into_lot_id', ''), nullif(x ->> 'group_id', ''), nullif(x ->> 'note', ''), v_actor, now()
    );
    pos := pos + 1;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p -> 'activity', '[]'::jsonb)) loop
    if x ->> 'kind' not in ('purchase', 'stock') or length(coalesce(x ->> 'message', '')) not between 1 and 400 then
      raise exception 'Registro de bitácora inválido.' using errcode = 'check_violation';
    end if;
    select * into proj from public.projects where organization_id = org and id = x ->> 'project_id';
    if not found then
      raise exception 'Proyecto no encontrado.' using errcode = 'no_data_found';
    end if;
    insert into public.activity_events (organization_id, id, project_id, position, at, actor, kind, message)
    values (
      org, private.safe_id(x ->> 'id', 'act'), proj.id, private.next_position('activity_events', org, proj.id), now(), v_actor,
      x ->> 'kind', x ->> 'message'
    );
  end loop;

  -- Estado de una línea de materiales (solo líneas de materiales de un proyecto de la empresa).
  for x in select * from jsonb_array_elements(coalesce(p -> 'line_statuses', '[]'::jsonb)) loop
    if x ->> 'status' not in ('pending', 'quoting', 'purchased', 'received') then
      raise exception 'Estado inválido.' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.budget_lines b
      where b.organization_id = org and b.project_id = x ->> 'project_id' and b.id = x ->> 'line_id' and b.category = 'materials'
    ) then
      raise exception 'Línea de materiales no encontrada.' using errcode = 'no_data_found';
    end if;
    insert into public.purchase_line_status (organization_id, project_id, line_id, status, updated_by, updated_at)
    values (org, x ->> 'project_id', x ->> 'line_id', x ->> 'status', v_actor, now())
    on conflict (organization_id, project_id, line_id)
    do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end loop;

  -- Pedidos de material del taller: Compras los da por resueltos o los cancela (solo los abiertos).
  for x in select * from jsonb_array_elements(coalesce(p -> 'request_statuses', '[]'::jsonb)) loop
    if x ->> 'status' not in ('resolved', 'cancelled') then
      raise exception 'Estado inválido.' using errcode = 'check_violation';
    end if;
    update public.material_requests set status = x ->> 'status', resolved_at = now(), resolved_by = v_actor
    where organization_id = org and id = x ->> 'id' and status = 'open';
  end loop;
end;
$$;

revoke all on function public.compras_save(jsonb) from public, anon;
grant execute on function public.compras_save(jsonb) to authenticated;

/**
 * Compras: proyectos SIN precio de venta, línea de base ni avance; solo las líneas de MATERIALES del costo
 * presupuestado; compras, consumos, stock, pedidos, precios de materiales, estados de línea y umbrales de alertas.
 * Ningún dato de mano de obra, precio de venta ni rentabilidad.
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
  select m.organization_id, m.display_name, o.name as org_name, o.alert_settings into me
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
      from public.price_history h where h.organization_id = me.organization_id and h.kind = 'material_price'), '[]'::jsonb),
    'line_statuses', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.project_id, s.line_id)
      from public.purchase_line_status s where s.organization_id = me.organization_id), '[]'::jsonb),
    'alert_settings', me.alert_settings
  );
end;
$$;

revoke all on function public.compras_workspace() from public, anon;
grant execute on function public.compras_workspace() to authenticated;
