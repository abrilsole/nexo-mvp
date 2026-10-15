-- ─────────────────────────────────────────────────────────────
-- Lote 5A · PARTE MANUAL. Correr a mano en el SQL Editor de Supabase (proyecto "nexo"),
-- DESPUÉS de 20261016120000_lote5a_roles_usuarios_vigencia.sql y ANTES de invitar usuarios
-- de Compras o Jefe de planta. Va aparte porque tiene DROP y DELETE (la herramienta automática
-- pide confirmación para esas sentencias).
--
-- 1. Amplía los roles válidos: owner/member (Administrativo), compras, jefe_planta, operator (Operario).
--    No cambia ninguna fila: solo la regla que valida la columna.
-- 2. reset_workspace (Restaurar demo / Vaciar datos): una cuenta Administrativa dada de baja ya no
--    puede usarlo. El cuerpo es el mismo de 20261009120150 con ese único cambio (por eso incluye DELETE).
-- ─────────────────────────────────────────────────────────────

alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members
  add constraint organization_members_role_check check (role in ('owner', 'member', 'compras', 'jefe_planta', 'operator'));

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
  where m.user_id = (select auth.uid()) and m.role in ('owner', 'member') and m.deactivated_at is null
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

revoke all on function public.reset_workspace(jsonb) from public, anon;
grant execute on function public.reset_workspace(jsonb) to authenticated;
