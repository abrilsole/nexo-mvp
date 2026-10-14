# Seguridad de Blerp (Lote 2)

**Estado:** 8 de octubre de 2026. Migraciones en `supabase/migrations/20261009120000_*` a `20261009120300_*`.

## Qué cambió, en una tabla

| Quién | Antes | Ahora |
|---|---|---|
| **Gestión** (owner / member) | Veía y escribía todo lo de su empresa | Igual: ve y escribe todo lo de su empresa |
| **Operario de Taller** activo | Por la base podía leer precios, márgenes y costos de **todos** los proyectos, editarlos y borrarlos | **No toca ninguna tabla directamente.** Lee con `taller_workspace()` solo sus proyectos asignados en Compras/Producción/Instalación, sin precios, costos ni márgenes, y escribe con las funciones `taller_*`, que calculan los costos en el servidor |
| **Operario dado de baja** | Seguía teniendo acceso a la base | **Sin acceso**: `active = false` o `deactivated_at` con fecha cortan cualquier política y función |
| Otra empresa | No veía nada | No ve nada |

**Reglas de negocio que ahora controla la base (triggers)**, además del navegador:

- Las etapas se avanzan de a una; volver atrás se permite como corrección. Para finalizar hay que cerrar el proyecto.
- El presupuesto base congelado no se puede reemplazar.
- El costo presupuestado solo se edita en Cotización y Aprobado.
- Horas, costos y consumos se registran solo en Compras, Producción e Instalación, en proyectos no cerrados.
- No se aceptan registros con fecha futura.
- Esos registros no se editan ni se borran: se corrigen con otro registro.
- Un operario no puede tener más de 24 h cargadas en el mismo día.
- No se elimina un operario con horas registradas: solo se lo da de baja.
- El libro de stock solo crece.
- Taller no puede consumir más material del asignado al proyecto, ni sacar material de otro proyecto. El costo del consumo siempre sale del lote (D3).

Estas reglas no aplican durante el reset de la demo (`reset_workspace`) ni en una empresa recién creada que todavía no cargó su demo, que es el primer ingreso de un usuario nuevo.

## `reset_workspace`

Aplicado en Supabase (verificado el 8/10/2026).

## Lote 3: operarios y horas extra

Migración `20261010120000_lote3_operarios_horas_extra.sql` (aplicada el 8/10/2026, sin DROP):

- `budget_lines` suma `operator_id`, `labor_role`, `hour_type` (normal / overtime) y `overtime_multiplier`. Es una tabla solo de Gestión: Taller no la lee y `taller_workspace()` no la incluye.
- El multiplicador de horas extra vive en `cost_settings`, con políticas solo para Gestión. No va en `organizations.alert_settings` porque la empresa la leen también los operarios activos.
- Tests en `tests/db/rls.test.ts` ("Lote 3"): Gestión guarda y ajusta; Taller y otra empresa no ven ni modifican nada.

## Lote 4: rubros, tarifas y gasto financiero

Migración `20261013120000_lote4_rubros.sql` (aplicada el 13/10/2026, sin DROP):

- **`hour_rates`** (nueva): tipos de hora y tarifa por hora. RLS: solo Gestión lee, crea y modifica. Taller no la lee y `taller_workspace()` no la incluye.
- **`cost_settings.financial_pct`** (nueva columna): gasto financiero. La tabla ya era solo de Gestión (Lote 3).
- **`budget_lines.rubro` y `hour_rate_id`** (nuevas columnas): tabla solo de Gestión.
- Funciones `private.legacy_category` y `private.legacy_rubro`: solo se usan en la conversión de datos. No tienen permiso para usuarios de la app.
- Tests en `tests/db/rls.test.ts` ("Lote 4"):
  - Gestión carga y cambia tarifas y gasto financiero.
  - Taller y otra empresa no leen ni cambian tarifas ni costos, y `taller_workspace()` no trae ninguna tarifa.
  - El mapeo de categorías de la base coincide con el de la app.
  - La conversión no cambia importes, incluido el presupuesto base de proyectos cerrados.
- El asesor de seguridad de Supabase no marca nada nuevo (siguen solo los dos avisos ya conocidos de abajo).

## Lote 4b: Diseño y Administración

Migración `20261014120000_lote4b_diseno_administracion.sql` (aplicada el 14/10/2026, sin DROP):

- `hour_rates` suma la columna `kind` (labor / design / admin) y el tipo de hora Diseño. Las políticas no cambian: solo Gestión lee y escribe.
- La columna vieja `category` queda en desuso; se explica en `docs/DECISIONES_RUBROS.md`.
- Función `private.design_or_admin`: solo para la conversión de datos. No tiene permiso para usuarios de la app.
- Tests en `tests/db/rls.test.ts` ("Lote 4b"):
  - el mapeo de líneas, costos reales y presupuesto base, con los mismos totales antes y después;
  - cada empresa tiene los tres tipos de hora;
  - Taller no ve las tarifas de Diseño ni de Administración.

## Cómo verificarlo

### 1. Tests automáticos (sin tocar la base real)

```bash
npm test
```

`tests/db/rls.test.ts` levanta un Postgres real en memoria (PGlite), aplica **todas** las migraciones del repo y prueba con tres usuarios:

- **Gestión (Laura):** ve precios y costos por hora. No puede saltar etapas, reemplazar el presupuesto base, editar el costo presupuestado en ejecución, cargar horas futuras o de más de 24 h por día, borrar un operario con horas ni editar el libro de stock.
- **Operario activo (Juan):** no ve ninguna tabla con plata y no puede escribir directo. `taller_workspace()` le trae solo sus proyectos, con precios y costos en 0. Carga horas y el servidor calcula el importe (3 h × $ 15.000 = $ 45.000). No carga en proyectos ajenos ni usa más material del asignado. Lo que registra en Taller lo ve Gestión.
- **Operario dado de baja (Diego):** antes de la baja entra; después, `taller_workspace()` devuelve `{ "status": "inactive" }`, no ve la empresa ni los archivos y no puede cargar nada. Con `deactivated_at` alcanza, aunque `active` quede en true. Al reactivarlo vuelve a entrar.

### 2. En Supabase (SQL Editor), sin cambiar datos

Cada consulta se hace pasar por un usuario y al final deshace todo (`rollback`).

**Gestión ve todo lo suyo** (reemplazá el id por el de tu usuario: `select user_id from organization_members`):

```sql
begin;
select set_config('request.jwt.claim.sub', 'ID-DE-TU-USUARIO', true);
set local role authenticated;
select count(*) as proyectos, count(*) filter (where sales_price > 0) as con_precio from projects;
rollback;
```

Resultado verificado el 8/10/2026: 12 proyectos, 12 con precio.

**Un usuario ajeno no ve nada:**

```sql
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select (select count(*) from projects) as proyectos, (select count(*) from operators) as operarios,
       (select count(*) from organizations) as empresas;
rollback;
```

Resultado verificado: 0, 0, 0.

**Un operario no ve plata** (cuando haya un operario con login: en Operarios cargale el email y que entre con Google):

```sql
begin;
select set_config('request.jwt.claim.sub', 'ID-DEL-OPERARIO', true);
set local role authenticated;
select (select count(*) from projects) as proyectos_directos,     -- tiene que dar 0
       taller_workspace() -> 'projects' as sus_proyectos;          -- sales_price en 0
rollback;
```

**La baja corta el acceso:** dalo de baja desde Operarios y repetí la consulta anterior. `taller_workspace()` tiene que devolver `{"status": "inactive"}`.

### 3. En la app (preview)

1. Entrá como Gestión: todo igual que antes.
2. En Operarios cargale tu otro email a un operario, asignalo a un proyecto en Producción y entrá con ese email desde una ventana privada. Tenés que ver solo ese proyecto, en Taller, sin ningún importe.
3. Cargá horas y material desde Taller. En Gestión, el proyecto muestra el costo calculado.
4. Dalo de baja desde Gestión y recargá la ventana del operario: aparece "Tu usuario de Taller fue dado de baja…".

## Pendientes y límites conocidos

- **Archivos (Storage):** las políticas de Storage no se pueden modificar desde una migración (la tabla es de Supabase). La baja ya corta el acceso a los archivos. Un operario **activo** puede ver los archivos de toda su empresa, no solo los de sus proyectos. Para restringirlo: Supabase → Storage → Policies → editar "members read project files" y "members upload project files" con la condición de `20261009120000_seguridad_1_roles_y_politicas.sql` (comentario "Archivos").
- **Mientras `main` no tenga este lote:** en la app publicada, "Reset demo" y "Vaciar datos" van a fallar, porque el código viejo borra tabla por tabla y la base ahora lo impide. El resto de la app publicada sigue funcionando.
- Los avisos automáticos de desvío en la Actividad ("Materiales superaron…") no se generan cuando carga un operario, porque Taller no conoce los costos. Las alertas se siguen calculando igual en Gestión.
- El asesor de Supabase marca que las funciones `taller_*` se pueden llamar con un usuario logueado. Es a propósito: cada una valida adentro que sea un operario activo y asignado.
- "Leaked password protection" está apagado. No aplica mientras el ingreso sea solo con Google.
