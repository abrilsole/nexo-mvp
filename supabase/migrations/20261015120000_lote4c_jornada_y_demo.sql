-- ─────────────────────────────────────────────────────────────
-- Lote 4c · Jornada del operario en Configuración y empresa demo.
--
-- 1. cost_settings.hours_per_day: jornada del operario (horas por día), 9,5 por
--    defecto, entre 1 y 24. La usan los días de trabajo, las horas extra, la
--    capacidad y el cálculo de atraso. Tabla solo de Gestión (Lote 3).
-- 2. budget_lines.hours_per_day: la jornada usada en cada línea de horas queda
--    congelada junto con su tarifa (unit_cost). Tabla solo de Gestión.
-- 3. organizations.is_demo: true si la empresa tiene cargados los datos de
--    demostración. Así "Restaurar datos demo" y la etiqueta "Datos de
--    demostración" solo aparecen en la demo. demo_seeded no alcanza: también
--    queda en true después de "Vaciar datos".
--
-- Sin DROP: ADD COLUMN / UPDATE.
-- ─────────────────────────────────────────────────────────────

alter table public.cost_settings
  add column if not exists hours_per_day numeric not null default 9.5;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_settings_hours_per_day_check') then
    alter table public.cost_settings
      add constraint cost_settings_hours_per_day_check check (hours_per_day >= 1 and hours_per_day <= 24);
  end if;
end $$;

alter table public.budget_lines
  add column if not exists hours_per_day numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'budget_lines_hours_per_day_check') then
    alter table public.budget_lines
      add constraint budget_lines_hours_per_day_check check (hours_per_day is null or (hours_per_day >= 1 and hours_per_day <= 24));
  end if;
end $$;

alter table public.organizations
  add column if not exists is_demo boolean not null default false;

-- Empresas que ya existen: son demo si tienen el proyecto principal de la demo (P-1042).
update public.organizations o
set is_demo = true
where not o.is_demo
  and exists (select 1 from public.projects p where p.organization_id = o.id and p.id = 'p-1042');
