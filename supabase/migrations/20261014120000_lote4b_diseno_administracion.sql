-- ─────────────────────────────────────────────────────────────
-- Lote 4b · Diseño y Administración por separado.
--
-- 1. Tipos de hora: Mano de obra, Diseño y Administración, cada uno con su tarifa.
--    La categoría del tipo de hora pasa a la columna `kind` (labor / design / admin).
--    La columna vieja `category` solo aceptaba labor / admin y cambiar esa regla
--    requeriría un DROP: queda en desuso (con valor por defecto) y la app no la usa.
-- 2. Las líneas de "Administración y diseño" pasan a Diseño solo si la descripción o
--    el tipo de hora indican diseño (y no administración); en cualquier otro caso, a
--    Administración. Las horas guardan el tipo de hora; la tarifa ya está congelada
--    en unit_cost. Mismo criterio para costos reales y presupuesto base.
--
-- Sin DROP: ADD COLUMN / CREATE OR REPLACE / INSERT / UPDATE.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Tipos de hora ─────────────────────────────────────────

alter table public.hour_rates add column if not exists kind text;

update public.hour_rates set kind = category where kind is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hour_rates_kind_check') then
    alter table public.hour_rates add constraint hour_rates_kind_check check (kind in ('labor', 'design', 'admin'));
  end if;
end $$;

alter table public.hour_rates alter column kind set not null;
alter table public.hour_rates alter column category set default 'labor';
comment on column public.hour_rates.category is 'En desuso desde el Lote 4b: la categoría del tipo de hora está en kind.';

-- "Administrativa / diseño" pasa a "Administración" (se conserva la tarifa que tenga).
update public.hour_rates
set name = 'Administración', position = 2, updated_at = now()
where id = 'admin' and name = 'Administrativa / diseño';

-- Diseño arranca con la misma tarifa que tenía "Administrativa / diseño" en cada empresa (27.000 si no había).
insert into public.hour_rates (organization_id, id, name, hourly_rate, kind, position)
select o.id, 'design', 'Diseño', coalesce(a.hourly_rate, 27000), 'design', 1
from public.organizations o
left join public.hour_rates a on a.organization_id = o.id and a.id = 'admin'
on conflict (organization_id, id) do nothing;

-- Empresas que todavía no tenían tarifas: las tres iniciales.
insert into public.hour_rates (organization_id, id, name, hourly_rate, kind, position)
select o.id, r.id, r.name, r.hourly_rate, r.kind, r.position
from public.organizations o
cross join (values
  ('labor', 'Mano de obra', 19000::numeric, 'labor', 0),
  ('admin', 'Administración', 27000::numeric, 'admin', 2)
) as r (id, name, hourly_rate, kind, position)
on conflict (organization_id, id) do nothing;

-- ── 2. Diseño o Administración en lo ya cargado ──────────────

-- Diseño solo si el tipo de hora es diseño, o si la descripción habla de diseño y no de administración.
create or replace function private.design_or_admin(p_description text, p_hour_rate_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_hour_rate_id = 'design' then 'design'
    when coalesce(p_description, '') ~* 'dise[ñn]' and coalesce(p_description, '') !~* 'administra' then 'design'
    else 'admin'
  end;
$$;

revoke all on function private.design_or_admin(text, text) from public;

-- Carga masiva: la categoría es clasificación, no cambia importes ni fechas.
select set_config('blerp.bulk', 'on', true);

update public.budget_lines
set category = private.design_or_admin(description, hour_rate_id),
    hour_rate_id = case when unit = 'h' then private.design_or_admin(description, hour_rate_id) else hour_rate_id end
where category = 'admin';

update public.actual_entries
set category = private.design_or_admin(description, null)
where category = 'admin';

update public.projects p
set baseline = jsonb_set(
  p.baseline,
  '{lines}',
  (
    select coalesce(jsonb_agg(
      case when l.value ->> 'category' = 'admin'
        then l.value || jsonb_build_object('category', private.design_or_admin(l.value ->> 'description', l.value ->> 'hourRateId'))
        else l.value
      end order by l.ord), '[]'::jsonb)
    from jsonb_array_elements(p.baseline -> 'lines') with ordinality as l (value, ord)
  )
)
where p.baseline is not null
  and jsonb_typeof(p.baseline -> 'lines') = 'array'
  and exists (select 1 from jsonb_array_elements(p.baseline -> 'lines') l where l ->> 'category' = 'admin');

select set_config('blerp.bulk', 'off', true);
