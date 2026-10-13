-- ─────────────────────────────────────────────────────────────
-- Lote 4 · Cotización por rubros.
--
-- 1. Cada línea del costo presupuestado guarda su RUBRO y, si son horas, el tipo de hora
--    cuya tarifa se usó (la tarifa queda congelada en unit_cost).
-- 2. hour_rates: tipos de hora con su tarifa. Solo Gestión (Taller no la lee ni la recibe
--    en taller_workspace()).
-- 3. cost_settings suma el gasto financiero (% sobre el precio de venta, 5 por defecto).
-- 4. Categorías: las siete anteriores pasan a las seis nuevas (ver docs/DECISIONES_RUBROS.md).
--    No se borra nada: se reetiqueta categoría y se infiere el rubro por la descripción.
--
-- Sin DROP: solo ADD COLUMN / CREATE ... IF NOT EXISTS / CREATE OR REPLACE / UPDATE.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Rubro y tipo de hora en cada línea ────────────────────

alter table public.budget_lines
  add column if not exists rubro text,
  add column if not exists hour_rate_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'budget_lines_rubro_check') then
    alter table public.budget_lines
      add constraint budget_lines_rubro_check check (rubro is null or rubro in (
        'carpinteria_madera', 'carpinteria_metalica', 'plasticos', 'vidrios', 'instalacion_electrica', 'pintura',
        'herrajes', 'graficas', 'insumos', 'transporte', 'embalaje', 'montaje', 'imprevistos'
      ));
  end if;
end $$;

-- ── 2. Tipos de hora y tarifas (solo Gestión) ────────────────

create table if not exists public.hour_rates (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  id text not null,
  name text not null,
  hourly_rate numeric not null check (hourly_rate > 0),
  category text not null check (category in ('labor', 'admin')),
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, id)
);

alter table public.hour_rates enable row level security;
revoke all on public.hour_rates from anon;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hour_rates' and policyname = 'managers read hour rates') then
    create policy "managers read hour rates" on public.hour_rates for select to authenticated
      using ((select private.is_org_manager(organization_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hour_rates' and policyname = 'managers insert hour rates') then
    create policy "managers insert hour rates" on public.hour_rates for insert to authenticated
      with check ((select private.is_org_manager(organization_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hour_rates' and policyname = 'managers update hour rates') then
    create policy "managers update hour rates" on public.hour_rates for update to authenticated
      using ((select private.is_org_manager(organization_id)))
      with check ((select private.is_org_manager(organization_id)));
  end if;
end $$;

-- Tarifas iniciales (las del cliente piloto) para las empresas que ya existen. Se cambian en Configuración.
insert into public.hour_rates (organization_id, id, name, hourly_rate, category, position)
select o.id, r.id, r.name, r.hourly_rate, r.category, r.position
from public.organizations o
cross join (values
  ('labor', 'Mano de obra', 19000::numeric, 'labor', 0),
  ('admin', 'Administrativa / diseño', 27000::numeric, 'admin', 1)
) as r (id, name, hourly_rate, category, position)
on conflict (organization_id, id) do nothing;

-- ── 3. Gasto financiero ──────────────────────────────────────

alter table public.cost_settings
  add column if not exists financial_pct numeric not null default 5;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_settings_financial_pct_check') then
    alter table public.cost_settings
      add constraint cost_settings_financial_pct_check check (financial_pct >= 0 and financial_pct < 50);
  end if;
end $$;

-- ── 4. Mapeo de categorías anteriores ────────────────────────

-- Categoría nueva de una categoría vieja (misma regla que normalizeCategory en lib/constants.ts).
create or replace function private.legacy_category(p_category text, p_description text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_category in ('materials', 'labor', 'admin', 'transport', 'financial', 'contingency') then p_category
    when p_category in ('machines', 'installation') then 'labor'
    when p_category in ('outsourcing', 'finishing') then 'materials'
    when p_category = 'logistics' then 'transport'
    when p_category = 'other' and coalesce(p_description, '') ~* '^\s*m[aá]quina' then 'labor'
    else 'contingency'
  end;
$$;

-- Rubro de una línea vieja: por la categoría y, si no alcanza, por palabras de la descripción.
-- Materiales sin pista → Carpintería madera. Horas y máquinas sin pista → sin rubro (no se inventa).
create or replace function private.legacy_rubro(p_category text, p_description text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_category in ('logistics', 'transport') then 'transporte'
    when p_category = 'installation' then 'montaje'
    when p_category in ('contingency', 'unexpected') then 'imprevistos'
    when p_category = 'other' and coalesce(p_description, '') !~* '^\s*m[aá]quina' then 'imprevistos'
    when d ~ '(herraj|bisagra|corredera|manija|tirador|cerradura)' then 'herrajes'
    when d ~ '(vidri|espejo|cristal)' then 'vidrios'
    when d ~ '(acr[ií]lic|pl[aá]stic|pvc|policarbonato)' then 'plasticos'
    when d ~ '(hierro|caño|chapa|metal|alumin|herrer[ií]a|acero)' then 'carpinteria_metalica'
    when d ~ '(pintur|laca|laque|barniz|lustr|epoxi|poliuret|enchap)' then 'pintura'
    when d ~ '(el[eé]ctric|cable|ilumin|\mled\M)' then 'instalacion_electrica'
    when d ~ '(gr[aá]fic|vinil|ploteo|impres)' then 'graficas'
    when d ~ '(embalaj|film|cart[oó]n)' then 'embalaje'
    when d ~ '(tornill|adhesiv|lija|silicona|insumo)' then 'insumos'
    when d ~ '(flete|transporte|env[ií]o)' then 'transporte'
    when d ~ '(instalaci[oó]n|montaje)' then 'montaje'
    when p_category = 'materials' then 'carpinteria_madera'
    else null
  end
  from (select lower(coalesce(p_description, '')) as d) as x;
$$;

revoke all on function private.legacy_category(text, text) from public;
revoke all on function private.legacy_rubro(text, text) from public;

-- Carga masiva: las reglas de los triggers no aplican a esta conversión (la categoría y el rubro
-- son clasificación, no cambian importes ni fechas).
select set_config('blerp.bulk', 'on', true);

update public.budget_lines
set rubro = coalesce(rubro, private.legacy_rubro(category, description)),
    category = private.legacy_category(category, description)
where rubro is null
   or category not in ('materials', 'labor', 'admin', 'transport', 'financial', 'contingency');

update public.actual_entries
set category = private.legacy_category(category, description)
where category not in ('materials', 'labor', 'admin', 'transport', 'financial', 'contingency');

-- Presupuesto base congelado (JSON): se reetiqueta la categoría de cada línea, en el mismo orden.
update public.projects p
set baseline = jsonb_set(
  p.baseline,
  '{lines}',
  (
    select coalesce(jsonb_agg(l.value || jsonb_build_object('category', private.legacy_category(l.value ->> 'category', l.value ->> 'description')) order by l.ord), '[]'::jsonb)
    from jsonb_array_elements(p.baseline -> 'lines') with ordinality as l (value, ord)
  )
)
where p.baseline is not null
  and jsonb_typeof(p.baseline -> 'lines') = 'array'
  and exists (
    select 1 from jsonb_array_elements(p.baseline -> 'lines') l
    where l ->> 'category' not in ('materials', 'labor', 'admin', 'transport', 'financial', 'contingency')
  );

select set_config('blerp.bulk', 'off', true);
