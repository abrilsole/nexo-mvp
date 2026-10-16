-- ─────────────────────────────────────────────────────────────
-- Lote 6 · Fase 2 · Órdenes de compra y costo real de materiales.
--
-- 1. purchase_orders / purchase_order_lines: Compras agrupa materiales de uno o varios proyectos en una orden
--    con número correlativo por empresa (OC-0001), proveedor y fecha. Estados: Borrador → Enviada → Facturada
--    (n° de factura, monto y fecha); aparte, Pagada sí/no y Recibida no/parcial/sí. Registro manual: sin mail ni banco.
-- 2. El costo REAL de materiales del proyecto se actualiza al FACTURAR: la base crea una compra real
--    (purchase_entries, id "pur-" + línea) por cada línea, con el precio negociado. "Pagada" es información
--    financiera y no cambia ningún costo.
-- 3. Recibir: la base crea el lote de stock del proyecto y su movimiento (el material entra al proyecto).
-- 4. Compras ve el stock en modo SOLO CONSULTA: compras_save ya no acepta lotes, movimientos, ubicaciones ni
--    compras sueltas (solo resolver pedidos del taller). Las compras entran por órdenes.
-- 5. compras_workspace() suma las órdenes y sus líneas. planta_workspace() suma el ESTADO de materiales de cada
--    proyecto (Sin comprar / En camino / Completo), calculado acá porque el Jefe de planta no recibe costos ni órdenes.
--
-- Sin DROP ni DELETE: CREATE ... IF NOT EXISTS / CREATE OR REPLACE. La tabla purchase_line_status (Lote 5C) queda
-- sin uso: el estado de cada material ahora se deriva de las órdenes.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.purchase_orders (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  id text not null,
  number text not null,
  supplier text not null,
  date date not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'invoiced')),
  invoice_number text,
  invoice_amount numeric check (invoice_amount is null or invoice_amount > 0),
  invoice_date date,
  paid boolean not null default false,
  received text not null default 'no' check (received in ('no', 'partial', 'yes')),
  notes text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  unique (organization_id, number)
);

create table if not exists public.purchase_order_lines (
  organization_id uuid not null,
  id text not null,
  order_id text not null,
  position integer not null default 0,
  project_id text not null,
  budget_line_id text not null,
  material_id text,
  material_name text not null,
  unit text not null default '',
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost > 0),
  received_quantity numeric not null default 0 check (received_quantity >= 0),
  note text,
  removed_at timestamptz,
  primary key (organization_id, id),
  foreign key (organization_id, order_id) references public.purchase_orders (organization_id, id) on delete cascade,
  foreign key (organization_id, project_id) references public.projects (organization_id, id) on delete cascade
);
create index if not exists purchase_order_lines_order_idx on public.purchase_order_lines (organization_id, order_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
revoke all on public.purchase_orders from anon;
revoke all on public.purchase_order_lines from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'purchase_orders' and policyname = 'buyers read orders') then
    create policy "buyers read orders" on public.purchase_orders for select to authenticated
      using ((select private.is_org_manager(organization_id)) or (select private.is_staff(organization_id, 'compras')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'purchase_order_lines' and policyname = 'buyers read order lines') then
    create policy "buyers read order lines" on public.purchase_order_lines for select to authenticated
      using ((select private.is_org_manager(organization_id)) or (select private.is_staff(organization_id, 'compras')));
  end if;
end $$;

/** Quién opera (Compras o Administrativo activo): para "created_by" y la bitácora. */
create or replace function private.buyer_name(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(m.display_name), ''), 'Compras') from public.organization_members m
  where m.user_id = (select auth.uid()) and m.organization_id = org order by m.created_at limit 1;
$$;

revoke all on function private.buyer_name(uuid) from public;
grant execute on function private.buyer_name(uuid) to authenticated;

/**
 * Crea una orden (número correlativo de la empresa) o modifica una en Borrador. `p.lines`: líneas de materiales de
 * proyectos aprobados (cantidad y costo unitario real conseguido > 0). Las líneas que no vienen quedan quitadas.
 */
create or replace function public.compras_order_save(p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_buy_org();
  v_id text := private.safe_id(p ->> 'id', 'oc');
  cur public.purchase_orders;
  v_number text;
  x jsonb;
  pos integer := 0;
  ids text[] := '{}';
begin
  if length(trim(coalesce(p ->> 'supplier', ''))) = 0 then
    raise exception 'Indicá el proveedor.' using errcode = 'check_violation';
  end if;
  if (p ->> 'date') is null then
    raise exception 'Indicá la fecha de la orden.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then
    raise exception 'La orden necesita al menos un material.' using errcode = 'check_violation';
  end if;
  select * into cur from public.purchase_orders o where o.organization_id = org and o.id = v_id;
  if found and cur.status <> 'draft' then
    raise exception 'Solo se modifica una orden en Borrador.' using errcode = 'check_violation';
  end if;
  if not found then
    perform pg_advisory_xact_lock(hashtext(org::text || ':oc'));
    select 'OC-' || lpad((coalesce(max(substring(o.number from 4)::integer), 0) + 1)::text, 4, '0') into v_number
    from public.purchase_orders o where o.organization_id = org and o.number ~ '^OC-[0-9]+$';
    insert into public.purchase_orders (organization_id, id, number, supplier, date, notes, created_by)
    values (org, v_id, v_number, trim(p ->> 'supplier'), (p ->> 'date')::date, nullif(trim(p ->> 'notes'), ''), private.buyer_name(org));
  else
    update public.purchase_orders set supplier = trim(p ->> 'supplier'), date = (p ->> 'date')::date, notes = nullif(trim(p ->> 'notes'), ''), updated_at = now()
    where organization_id = org and id = v_id;
  end if;

  for x in select * from jsonb_array_elements(p -> 'lines') loop
    if not exists (
      select 1 from public.budget_lines b join public.projects pr on pr.organization_id = b.organization_id and pr.id = b.project_id
      where b.organization_id = org and b.project_id = x ->> 'project_id' and b.id = x ->> 'budget_line_id' and b.category = 'materials'
        and not pr.is_closed and pr.status <> 'quotation'
    ) then
      raise exception 'Cada línea tiene que ser un material de un proyecto aprobado.' using errcode = 'check_violation';
    end if;
    if coalesce((x ->> 'quantity')::numeric, 0) <= 0 or coalesce((x ->> 'unit_cost')::numeric, 0) <= 0 then
      raise exception 'Indicá cantidad y costo unitario real (mayores a cero).' using errcode = 'check_violation';
    end if;
    insert into public.purchase_order_lines (organization_id, id, order_id, position, project_id, budget_line_id, material_id, material_name, unit, quantity, unit_cost, note)
    values (org, private.safe_id(x ->> 'id', 'ocl'), v_id, pos, x ->> 'project_id', x ->> 'budget_line_id', nullif(x ->> 'material_id', ''),
            trim(x ->> 'material_name'), coalesce(x ->> 'unit', ''), (x ->> 'quantity')::numeric, (x ->> 'unit_cost')::numeric, nullif(trim(x ->> 'note'), ''))
    on conflict (organization_id, id) do update
      set position = excluded.position, project_id = excluded.project_id, budget_line_id = excluded.budget_line_id, material_id = excluded.material_id,
          material_name = excluded.material_name, unit = excluded.unit, quantity = excluded.quantity, unit_cost = excluded.unit_cost,
          note = excluded.note, removed_at = null;
    ids := ids || private.safe_id(x ->> 'id', 'ocl');
    pos := pos + 1;
  end loop;
  update public.purchase_order_lines set removed_at = now()
  where organization_id = org and order_id = v_id and removed_at is null and not (id = any (ids));
  return v_id;
end;
$$;

/**
 * Cambios de estado de una orden. `p.action`:
 *  - send: Borrador → Enviada.
 *  - invoice: Enviada → Facturada (n° de factura, monto, fecha). Crea la compra real de cada línea con su precio:
 *    desde acá cambia el costo real de materiales del proyecto.
 *  - paid: Pagada sí/no (solo Facturada). Información financiera: no cambia costos.
 *  - receive: recibe cantidades por línea (`p.receipts`: line_id, quantity, lot_id, movement_id, material_key). Crea el lote del
 *    proyecto y su movimiento de entrada. Recibida queda en parcial o sí.
 */
create or replace function public.compras_order_status(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_buy_org();
  o public.purchase_orders;
  l public.purchase_order_lines;
  x jsonb;
  v_actor text := private.buyer_name(org);
  v_qty numeric;
  pos integer;
begin
  select * into o from public.purchase_orders where organization_id = org and id = p ->> 'id' for update;
  if not found then
    raise exception 'Orden no encontrada.' using errcode = 'no_data_found';
  end if;

  if p ->> 'action' = 'send' then
    if o.status <> 'draft' then raise exception 'Solo se envía una orden en Borrador.' using errcode = 'check_violation'; end if;
    update public.purchase_orders set status = 'sent', updated_at = now() where organization_id = org and id = o.id;

  elsif p ->> 'action' = 'invoice' then
    if o.status <> 'sent' then raise exception 'Solo se factura una orden Enviada.' using errcode = 'check_violation'; end if;
    if length(trim(coalesce(p ->> 'invoice_number', ''))) = 0 or coalesce((p ->> 'invoice_amount')::numeric, 0) <= 0 or (p ->> 'invoice_date') is null then
      raise exception 'Indicá número, monto y fecha de la factura.' using errcode = 'check_violation';
    end if;
    update public.purchase_orders
      set status = 'invoiced', invoice_number = trim(p ->> 'invoice_number'), invoice_amount = (p ->> 'invoice_amount')::numeric,
          invoice_date = (p ->> 'invoice_date')::date, updated_at = now()
    where organization_id = org and id = o.id;
    -- La compra real de cada línea: desde acá cambia el costo real de materiales del proyecto.
    for l in select * from public.purchase_order_lines where organization_id = org and order_id = o.id and removed_at is null order by position loop
      insert into public.purchase_entries (
        organization_id, id, project_id, position, material_id, material_name, quantity, unit, unit_cost, total, supplier, date, notes, created_by, created_at
      ) values (
        org, 'pur-' || l.id, l.project_id, private.next_position('purchase_entries', org, l.project_id), l.material_id, l.material_name,
        l.quantity, l.unit, l.unit_cost, round(l.quantity * l.unit_cost, 2), o.supplier, (p ->> 'invoice_date')::date,
        o.number || ' · factura ' || trim(p ->> 'invoice_number'), v_actor, now()
      );
      insert into public.activity_events (organization_id, id, project_id, position, at, actor, kind, message)
      values (
        org, private.safe_id(null, 'act'), l.project_id, private.next_position('activity_events', org, l.project_id), now(), v_actor, 'purchase',
        'Factura ' || trim(p ->> 'invoice_number') || ' de ' || o.supplier || ' (' || o.number || '): ' || private.fmt_num(l.quantity) || ' ' || l.unit || ' de ' || l.material_name || '.'
      );
      update public.projects set updated_at = now() where organization_id = org and id = l.project_id;
    end loop;

  elsif p ->> 'action' = 'paid' then
    if o.status <> 'invoiced' then raise exception 'Solo se marca como pagada una orden Facturada.' using errcode = 'check_violation'; end if;
    update public.purchase_orders set paid = coalesce((p ->> 'paid')::boolean, true), updated_at = now() where organization_id = org and id = o.id;

  elsif p ->> 'action' = 'receive' then
    if o.status = 'draft' then raise exception 'Primero enviá la orden.' using errcode = 'check_violation'; end if;
    select coalesce(max(s.position) + 1, 0) into pos from public.stock_movements s where s.organization_id = org;
    for x in select * from jsonb_array_elements(coalesce(p -> 'receipts', '[]'::jsonb)) loop
      select * into l from public.purchase_order_lines where organization_id = org and order_id = o.id and id = x ->> 'line_id' and removed_at is null;
      if not found then raise exception 'Línea de la orden no encontrada.' using errcode = 'no_data_found'; end if;
      v_qty := (x ->> 'quantity')::numeric;
      if v_qty is null or v_qty <= 0 or l.received_quantity + v_qty > l.quantity then
        raise exception 'No se puede recibir más de lo pedido (% de %).', private.fmt_num(l.received_quantity + coalesce(v_qty, 0)), private.fmt_num(l.quantity)
          using errcode = 'check_violation';
      end if;
      insert into public.stock_lots (
        organization_id, id, material_id, material_name, unit, unit_cost, kind, supplier, purchase_entry_id, origin_project_id, origin_project_name, created_by, created_at
      ) values (
        org, private.safe_id(x ->> 'lot_id', 'lot'), coalesce(l.material_id, nullif(x ->> 'material_key', ''), 'custom:' || l.id),
        l.material_name, l.unit, l.unit_cost, 'purchase', o.supplier,
        case when exists (select 1 from public.purchase_entries e where e.organization_id = org and e.id = 'pur-' || l.id) then 'pur-' || l.id end,
        l.project_id, (select pr.code || ' · ' || pr.name from public.projects pr where pr.organization_id = org and pr.id = l.project_id), v_actor, now()
      );
      insert into public.stock_movements (organization_id, id, lot_id, position, kind, quantity, from_place, to_place, date, project_id, note, created_by, created_at)
      values (
        org, private.safe_id(x ->> 'movement_id', 'mov'), private.safe_id(x ->> 'lot_id', 'lot'), pos, 'purchase_in', v_qty,
        '{"type":"supplier"}'::jsonb, jsonb_build_object('type', 'project', 'projectId', l.project_id), private.today_ar(), l.project_id,
        'Recibido de ' || o.number, v_actor, now()
      );
      pos := pos + 1;
      update public.purchase_order_lines set received_quantity = received_quantity + v_qty where organization_id = org and id = l.id;
    end loop;
    update public.purchase_orders
      set received = case
            when not exists (select 1 from public.purchase_order_lines z where z.organization_id = org and z.order_id = o.id and z.removed_at is null and z.received_quantity < z.quantity) then 'yes'
            when exists (select 1 from public.purchase_order_lines z where z.organization_id = org and z.order_id = o.id and z.removed_at is null and z.received_quantity > 0) then 'partial'
            else 'no' end,
          updated_at = now()
    where organization_id = org and id = o.id;
  else
    raise exception 'Acción inválida.' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.compras_order_save(jsonb) from public, anon;
revoke all on function public.compras_order_status(jsonb) from public, anon;
grant execute on function public.compras_order_save(jsonb) to authenticated;
grant execute on function public.compras_order_status(jsonb) to authenticated;

/**
 * Lo único que Compras escribe fuera de las órdenes: dar por resuelto o cancelar un pedido de material del taller.
 * El stock es solo consulta para Compras (sin lotes, movimientos ni ubicaciones) y las compras entran por órdenes.
 */
create or replace function public.compras_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.my_buy_org();
  x jsonb;
begin
  if coalesce(jsonb_array_length(p -> 'purchases'), 0) + coalesce(jsonb_array_length(p -> 'lots'), 0)
     + coalesce(jsonb_array_length(p -> 'movements'), 0) + coalesce(jsonb_array_length(p -> 'lot_locations'), 0)
     + coalesce(jsonb_array_length(p -> 'activity'), 0) + coalesce(jsonb_array_length(p -> 'line_statuses'), 0) > 0 then
    raise exception 'El stock es solo consulta para Compras y las compras se registran con órdenes de compra.' using errcode = 'insufficient_privilege';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p -> 'request_statuses', '[]'::jsonb)) loop
    if x ->> 'status' not in ('resolved', 'cancelled') then
      raise exception 'Estado inválido.' using errcode = 'check_violation';
    end if;
    update public.material_requests set status = x ->> 'status', resolved_at = now(), resolved_by = private.buyer_name(org)
    where organization_id = org and id = x ->> 'id' and status = 'open';
  end loop;
end;
$$;

/**
 * Compras: proyectos SIN precio de venta, línea de base ni avance; solo las líneas de MATERIALES; compras, consumos,
 * stock, pedidos, precios de materiales, órdenes de compra y umbrales de alertas. Nada de mano de obra ni rentabilidad.
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
    'purchase_orders', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.number)
      from public.purchase_orders o where o.organization_id = me.organization_id), '[]'::jsonb),
    'purchase_order_lines', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.order_id, l.position)
      from public.purchase_order_lines l where l.organization_id = me.organization_id and l.removed_at is null), '[]'::jsonb),
    'alert_settings', me.alert_settings
  );
end;
$$;

/**
 * Órdenes de la demo en un solo paso ("Restaurar datos demo"). Solo Administrativo. Respeta el número y el estado que
 * trae el seed; las compras reales y el stock de esas órdenes ya vienen en el resto de la demo.
 */
create or replace function public.compras_load_orders(p jsonb)
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
  -- reset_workspace borró los proyectos y con ellos las líneas de las órdenes. Las órdenes que quedan sin líneas no se
  -- borran (sin DELETE): la app no muestra órdenes vacías. Las de la demo vuelven a su estado original. Si una orden vacía
  -- ocupa un número de la demo, se le cambia el número (queda "OC-0001 (anterior oc_x)") para no repetirlo.
  update public.purchase_orders o
    set number = o.number || ' (anterior ' || o.id || ')', updated_at = now()
  where o.organization_id = org
    and not exists (select 1 from public.purchase_order_lines l where l.organization_id = org and l.order_id = o.id)
    and o.number in (select x ->> 'number' from jsonb_array_elements(coalesce(p -> 'orders', '[]'::jsonb)) x where x ->> 'id' <> o.id);
  insert into public.purchase_orders (organization_id, id, number, supplier, date, status, invoice_number, invoice_amount, invoice_date, paid, received, notes, created_by, created_at)
  select org, o ->> 'id', o ->> 'number', o ->> 'supplier', (o ->> 'date')::date, o ->> 'status', nullif(o ->> 'invoice_number', ''),
         nullif(o ->> 'invoice_amount', '')::numeric, nullif(o ->> 'invoice_date', '')::date, coalesce((o ->> 'paid')::boolean, false),
         coalesce(o ->> 'received', 'no'), nullif(o ->> 'notes', ''), coalesce(o ->> 'created_by', ''), coalesce((o ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(coalesce(p -> 'orders', '[]'::jsonb)) o
  on conflict (organization_id, id) do update
    set number = excluded.number, supplier = excluded.supplier, date = excluded.date, status = excluded.status,
        invoice_number = excluded.invoice_number, invoice_amount = excluded.invoice_amount, invoice_date = excluded.invoice_date,
        paid = excluded.paid, received = excluded.received, notes = excluded.notes, updated_at = now();
  insert into public.purchase_order_lines (organization_id, id, order_id, position, project_id, budget_line_id, material_id, material_name, unit, quantity, unit_cost, received_quantity)
  select org, l ->> 'id', l ->> 'order_id', coalesce((l ->> 'position')::integer, 0), l ->> 'project_id', l ->> 'budget_line_id', nullif(l ->> 'material_id', ''),
         l ->> 'material_name', coalesce(l ->> 'unit', ''), (l ->> 'quantity')::numeric, (l ->> 'unit_cost')::numeric, coalesce((l ->> 'received_quantity')::numeric, 0)
  from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) l
  where exists (select 1 from public.projects pr where pr.organization_id = org and pr.id = l ->> 'project_id')
  on conflict (organization_id, id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.compras_load_orders(jsonb) from public, anon;
grant execute on function public.compras_load_orders(jsonb) to authenticated;

/**
 * Estado de materiales de un proyecto, sin importes (misma regla que materialsState en lib/purchasing.ts):
 * Completo = todo lo necesario recibido (de órdenes, compras directas o asignado del depósito) · Sin comprar = nada pedido ni recibido · En camino = el resto.
 * null si no tiene materiales con cantidad.
 */
create or replace function private.materials_state(org uuid, project text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with needs as (
    select b.id, b.quantity,
      coalesce((select sum(l.quantity) from public.purchase_order_lines l
                where l.organization_id = org and l.project_id = project and l.budget_line_id = b.id and l.removed_at is null), 0) as ordered,
      coalesce((select sum(l.received_quantity) from public.purchase_order_lines l
                where l.organization_id = org and l.project_id = project and l.budget_line_id = b.id and l.removed_at is null), 0)
      + coalesce((select sum(e.quantity) from public.purchase_entries e
                  where e.organization_id = org and e.project_id = project
                    and not exists (select 1 from public.purchase_order_lines l where l.organization_id = org and 'pur-' || l.id = e.id)
                    and (e.material_id = b.material_id or (b.material_id is null and e.material_name = b.description))), 0)
      + greatest(0, coalesce((select sum(case when m.kind = 'assign' then m.quantity else -m.quantity end)
                  from public.stock_movements m
                  join public.stock_lots s on s.organization_id = m.organization_id and s.id = m.lot_id
                  where m.organization_id = org
                    and ((m.kind = 'assign' and m.to_place = jsonb_build_object('type', 'project', 'projectId', project))
                      or (m.kind = 'release' and m.from_place = jsonb_build_object('type', 'project', 'projectId', project)))
                    and (s.material_id = b.material_id or (b.material_id is null and s.material_name = b.description))), 0)) as received
    from public.budget_lines b
    where b.organization_id = org and b.project_id = project and b.category = 'materials' and b.quantity is not null
  )
  select case
    when not exists (select 1 from needs) then null
    when not exists (select 1 from needs where received < quantity) then 'complete'
    when not exists (select 1 from needs where ordered > 0 or received > 0) then 'none'
    else 'on_the_way'
  end;
$$;

revoke all on function private.materials_state(uuid, text) from public;
grant execute on function private.materials_state(uuid, text) to authenticated;

/**
 * Jefe de planta: proyectos sin importes (con el estado de materiales calculado acá), operarios sin costo por hora,
 * horas sin valor, productos, bitácora, pedidos, asignaciones, mano de obra estimada sin importes, jornada y umbrales.
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
    'hours_per_day', coalesce((select c.hours_per_day from public.cost_settings c where c.organization_id = me.organization_id), 9.5),
    'alert_settings', (select o.alert_settings from public.organizations o where o.id = me.organization_id)
  );
end;
$$;
