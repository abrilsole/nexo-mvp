# Historial de precios, valores congelados y correcciones (Lote 5A)

**Regla general: el pasado no se modifica nunca.**

## Qué tiene vigencia

Cada uno de estos valores se guarda con un **"vigente desde"** en la tabla `price_history`:

| Valor | `kind` | `subject_id` | Dónde se cambia |
|---|---|---|---|
| Tarifa por tipo de hora (Mano de obra, Diseño, Administración) | `hour_rate` | `labor` / `design` / `admin` | Configuración → Tarifas y horas |
| Multiplicador de horas extra | `overtime_multiplier` | `default` | Configuración → Tarifas y horas |
| Costo por hora de cada operario | `operator_cost` | id del operario | Operarios → Editar |
| Precio de catálogo de un material | `material_price` | id del material | Configuración → Tarifas y horas → Precios de materiales |

## Reglas de vigencia

- **Un cambio es un registro nuevo.** Nunca se edita ni se borra uno anterior. La base lo impide incluso con acceso total (trigger `guard_append_only`).
- **Valor vigente en una fecha:** es el último registro con "vigente desde" ≤ esa fecha. Si hay dos el mismo día, vale el último cargado.
- **Antes del primer registro** vale el primero.
- **Sin registros**, vale el valor cargado de siempre: la columna de antes, o el precio de referencia del catálogo.
- **Misma regla en el código y en la base:**
  - función pura `rateAt` en `lib/price-history.ts`;
  - `private.value_at` en la base.
- **El primer cambio de un valor** también guarda el valor anterior "desde siempre" (2000-01-01). Así, las fechas anteriores al cambio siguen con el valor de antes.
- **Cambio con fecha futura:** queda **programado**. Hasta ese día se sigue usando el valor actual. El historial lo marca "programado".
- **Ejemplo (test):** un operario pasa de 10.000 a 15.000 a mitad de mes.
  - Las horas cargadas del 1 al 15 se valúan a 10.000.
  - Las horas cargadas desde el 16, a 15.000.
  - Cargar después el cambio no modifica ninguna hora ya guardada.

## Qué guarda cada registro

- **Horas cargadas:** guardan el costo por hora aplicado ese día (`labor.hourlyCost`) y el importe (`amount`).
  - Cuando carga un operario, el costo lo calcula la base (`taller_log_hours` → `private.labor_cost_at`).
  - Cuando carga un Administrativo, lo calcula la app con la misma regla.
- **Compras:** guardan el precio realmente pagado (`purchase_entries.unit_cost`, `stock_lots.unit_cost`).
- **Cotizaciones:** guardan la tarifa, la jornada y el precio de cada material con los que se hicieron (`budget_lines`).
  - El precio de catálogo de un material solo cambia el valor con el que arranca una **cotización nueva**.

## Pendiente del cliente: ¿con qué se valúan las horas reales?

No está definido si el costo real de una hora es:

- **el costo por hora de cada operario** (lo que cobra cada uno). Es la opción por defecto y lo que hacía Blerp hasta ahora; o
- **la tarifa general de Mano de obra.**

El modelo admite las dos (`cost_settings.labor_valuation`: `operator` / `general`). En los dos casos se usa el valor vigente el día de las horas. En Configuración → Tarifas y horas está marcado como **"Hipótesis a confirmar con el cliente"**.

## Valores congelados

- **Desde Aprobado, y en un proyecto cerrado,** quedan congelados el **precio de venta** y el **costo presupuestado**: todas sus líneas.
- **Antes:** el costo presupuestado se podía editar también en Aprobado.
- **Quién lo impide:** la base, con los triggers `guard_project_update` y `guard_budget_lines`. También lo impide la app, con `BUDGET_EDITABLE_STATUSES = ["quotation"]` y `lib/corrections.ts`.
- **Lo que ya estaba congelado desde antes:**
  - el presupuesto base (la copia que se toma al aprobar);
  - los registros de horas, costos y consumos (se corrigen con otro registro);
  - el libro de stock;
  - todo el proyecto una vez cerrado.

## Correcciones auditadas

- **Cuándo:** si hay un error en un valor congelado, en la pestaña del costo presupuestado aparece **"Corregir un valor"**. Solo la ve un Administrativo.
- **Qué se puede corregir:**
  - el precio de venta;
  - la cantidad de una línea del costo presupuestado;
  - el costo unitario de una línea.
- **Qué hace la corrección:** la hace la base (`admin_correct_value`):
  - exige un Administrativo activo y un motivo;
  - cambia el valor y recalcula el total de la línea;
  - deja el registro en `value_corrections`: quién, cuándo, valor anterior, valor nuevo y motivo;
  - agrega un evento en la Actividad del proyecto.
- **El registro no se puede editar ni borrar.**
- **Dónde se ven las correcciones:** la pestaña del costo presupuestado muestra la lista "Correcciones registradas".

## Migración de los datos existentes

- **Qué entra al historial:** cada tarifa, multiplicador y costo por hora que ya existía. Queda vigente desde la fecha de creación de la empresa (o del operario).
- **Para fechas anteriores** vale ese mismo valor (regla "antes del primer registro").
- **Importes:** la migración no cambia ninguno.
- **El test que lo prueba:** `tests/db/lote5a.test.ts`. Compara antes y después de migrar, sobre la demo completa:
  - precios de venta;
  - costo presupuestado;
  - costos reales;
  - compras, consumos y stock;
  - tarifas, costos por hora y presupuesto base.
- **Los precios de materiales** no tenían historial: siguen con el precio de referencia del catálogo hasta el primer cambio.
