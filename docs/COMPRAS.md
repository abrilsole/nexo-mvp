# Compras (Lote 6: necesidades y órdenes de compra)

Registro manual: no manda mails, no se conecta al banco y no adjunta facturas. Compras **nunca** ve precio de venta,
rentabilidad ni mano de obra.

## Menú de Compras

| Pantalla | Para qué |
|---|---|
| **Dashboard** | Qué pedir esta semana, órdenes abiertas, compras sobre lo estimado y alertas. |
| **Necesidades** | Materiales de cada proyecto **aprobado**: Por comprar / En orden de compra / Recibido. Desde acá se elige qué materiales van a una orden. |
| **Órdenes de compra** | Las órdenes (OC-0001, OC-0002…) con su estado, y la pestaña **Precios por proveedor**. |
| **Alertas** | Material sin pedir a pocos días del inicio y compras que costaron más que lo estimado. |
| **Cotizador** | Costo de materiales de un trabajo nuevo (solo materiales). |
| **Stock** | **Solo consulta** (la base no le deja escribir). |

## Necesidades

Cuando el Administrativo aprueba un proyecto, sus líneas de materiales aparecen en Necesidades. Para cada material:

- **Necesario:** la cantidad del presupuesto, con su **costo unitario estimado** (lo puso el Administrativo de memoria; no es real).
- **En órdenes / recibido:** lo que ya está en órdenes de compra y cuánto llegó.
- **Compras directas:** compras anteriores registradas sin orden (datos viejos de la demo).
- **Asignado del depósito:** lo que el Administrativo pasó del depósito al proyecto (Stock → Asignar).
- **Stock libre:** si en el depósito hay material libre, se descuenta de lo que falta pedir (es una sugerencia: el Administrativo lo asigna desde Stock). El stock libre se reparte entre proyectos por orden de inicio.
- **Falta pedir** = necesario − en órdenes − compras directas − asignado del depósito − stock libre.

Estado de la línea: **Recibido** si ya está todo en el proyecto (recibido de órdenes + directas + asignado del depósito); **En orden de compra** si hay algo pedido; si no, **Por comprar**.

### Estado de materiales del proyecto

Se calcula, nadie lo marca:

- **Sin comprar:** nada pedido ni recibido.
- **En camino:** algo pedido o recibido, pero no todo.
- **Completo:** todo lo necesario está en el proyecto.

Se ve como etiqueta en el proyecto (Administrativo), en Necesidades, en los Proyectos del Jefe de planta y en su cola
"Pendientes de asignar". Al asignar gente con materiales incompletos, se **avisa pero no se bloquea**.

## Orden de compra

1. **Borrador:** se crea desde Necesidades eligiendo materiales (pueden ser de varios proyectos). Lleva número correlativo (OC-0001…), proveedor, fecha, nota, y por material cantidad y **costo unitario real** (el que se consiguió; la negociación queda afuera del sistema). Solo el borrador se puede editar.
2. **Enviada:** Compras la marca cuando la mandó al proveedor (por fuera del sistema).
3. **Facturada:** se carga n° de factura, monto y fecha. **Ahí se registra el importe comprado**; el costo imputable al proyecto cambia con el consumo y el desperdicio: se crea una compra real por cada material con su proveedor y la nota "OC-0001 · factura …".
- **Pagada sí/no:** solo un dato; **no cambia el costo**.
- **Recibida no / parcial / sí:** se puede recibir en partes (desde Enviada). Lo que llega entra al stock del proyecto como un lote con el costo real de la orden.

## Costo de materiales en el proyecto: estimado vs real

En la pestaña Materiales del proyecto (Administrativo): por material, **estimado** (presupuesto) vs **real** (facturas
y compras directas), con la diferencia y el detalle de cada importe hasta su orden y factura. Siempre se distinguen
**compra** (lo facturado), **consumo** y **desperdicio** (lo que carga el taller) y **sobrante** (vuelve al depósito con
el costo de su lote).

## Supuestos (a validar con el cliente)

- **Para cuándo se necesita el material:** para el **día de inicio** del proyecto. "Esta semana" son los que arrancan en 7 días o menos (o ya arrancaron) y les falta pedir.
- **"Pocos días" de la alerta:** 7 días por defecto (Configuración → Alertas → Compras).
- **Compra más cara que lo estimado:** se compara el costo real por unidad con el estimado del mismo material en ese proyecto; avisa desde el % de Atención de categorías (Configuración → Alertas).
- El monto de la factura se guarda como dato; el costo real por material sale de cantidad × costo unitario real de cada línea.

## Cómo se hace cumplir en la base

Migración `supabase/migrations/20261020120000_lote6_ordenes_de_compra.sql`:

- Tablas `purchase_orders` y `purchase_order_lines`: las leen solo Administrativo y Compras; nadie escribe directo.
- `compras_order_save(p)`: crea o edita un **borrador**; el número correlativo lo pone la base (con bloqueo, sin saltos ni repetidos por empresa); valida proveedor, fecha, materiales de proyectos aprobados de la empresa y cantidades/costos > 0.
- `compras_order_status(p)`: enviar, facturar (crea las compras reales y la bitácora), pagada, recibir (crea lote y movimiento al proyecto; no deja recibir más de lo pedido). Valida cada transición.
- `compras_save(p)`: ahora **rechaza** compras, lotes, movimientos, bitácora y estados de línea: **el stock es solo consulta para Compras**. Solo resuelve o cancela pedidos del taller.
- Compras no tiene políticas sobre las tablas con importes (`projects`, `purchase_entries`, `stock_lots`…): lee con `compras_workspace()` (sin precio de venta, avance, mano de obra) y no puede insertar ni modificar stock.
- `private.materials_state()` calcula el estado de materiales y `planta_workspace()` se lo pasa al Jefe sin importes.
- Jefe de planta y Operario no pueden usar las funciones de órdenes ni leer las tablas.
- Quedan sin uso por la app: la tabla `purchase_line_status` (estados manuales del Lote 5C, reemplazados por el estado calculado) y las partes de escritura de `compras_save`.
- Tests: `tests/db/compras.test.ts` (Postgres real con PGlite), `tests/compras.test.ts` (cálculos), `tests/compras-pantallas.test.tsx` (pantallas).

## Qué quedó para después

- **Adjuntar facturas y mandar mails a proveedores:** no se hace. Los archivos tienen una brecha conocida en Storage: sus políticas **no se pueden cambiar con una migración** (la tabla es de Supabase). Ver `docs/SEGURIDAD.md` → "Archivos (Storage), sigue pendiente".
- Anular una orden enviada o corregir una factura: no está (habría que hacerlo a mano en la base).

## Archivos

- `lib/purchasing.ts`: necesidades, estado de materiales, costo estimado vs real, órdenes (validaciones, factura, recepción), alertas, precios por proveedor, cotizador. Funciones puras.
- `components/purchasing/`: pantallas. `components/materials/material-costs-card.tsx`: estimado vs real en el proyecto.
