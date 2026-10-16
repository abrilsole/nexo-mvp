# Compras (Lote 5C)

## Menú de Compras

| Sección | Qué hace |
|---|---|
| **Dashboard** | Qué hay que comprar esta semana, compras pendientes y compras que se pasaron del presupuesto. |
| **Proyectos** | Lista de materiales (BOM) de uno o varios proyectos, por proyecto o **consolidada**. Estado de cada línea y registro de compras. |
| **Alertas** | Material que se necesita en pocos días y todavía no se compró; compra más cara que lo presupuestado. |
| **Cotizador** | Cotizador de materiales: solo materiales y su costo (ver abajo). |
| **Historial** | Compras realizadas y precios de cada material por proveedor. |
| **Stock** | El mismo módulo de Stock del Administrativo, en `/compras/stock`. |

En ninguna de estas pantallas aparece el precio de venta, la rentabilidad ni el valor de la mano de obra. Con un usuario real de Compras la base ni siquiera los manda (`compras_workspace()`); en la demo, las funciones de `lib/purchasing.ts` solo arman datos de materiales.

## Circuito de una línea de materiales

1. **Pendiente:** está en el costo presupuestado y no se compró.
2. **Cotizando:** Compras lo marca mientras pide precios.
3. **Comprado:** se registra la compra real con:
   - proveedor;
   - precio realmente pagado por unidad;
   - fecha (no puede ser futura);
   - cantidad de cada proyecto.

   La compra queda guardada con su precio y su fecha (la vigencia del Lote 5A: no cambia el costo presupuestado ni lo ya registrado). También entra el lote al stock del proyecto y queda en la bitácora del proyecto. Elegir "Comprado" en el estado abre este mismo formulario.
4. **Recibido:** Compras lo marca cuando llega el material (solo si ya se compró algo).

Si se compró toda la cantidad presupuestada, la línea figura como Comprado aunque nadie lo haya marcado.

**Vista consolidada:** junta el mismo material (misma clave y unidad) de los proyectos elegidos. "Registrar compra" en una fila consolidada registra una sola compra (mismo proveedor, precio y fecha) repartida en una compra por proyecto con la cantidad de cada uno.

**Monto directo** (por ejemplo, "Pintura / Laqueados: trabajo comprado hecho"): se compra como 1 unidad por su monto.

## Supuestos (a validar con el cliente)

- **Para cuándo se necesita el material:** para el **día de inicio** del proyecto. "Esta semana" son los proyectos que arrancan en 7 días o menos, o que ya arrancaron y todavía les falta material.
- **"Pocos días" de la alerta:** 7 días de anticipación por defecto. Se cambia en **Configuración → Alertas → Compras**.
- **Compra más cara que lo presupuestado:** se compara el precio pagado por unidad contra el costo unitario presupuestado del mismo material en ese proyecto. Es "En riesgo" desde el mismo % que usa la alerta de categorías (Configuración → Alertas).
- Las compras de materiales que no estaban en el presupuesto no generan alerta de precio (no hay contra qué comparar).

## Cómo se hace cumplir en la base

- **Compras no tiene ninguna política** sobre las tablas con importes (`projects`, `budget_lines`, `purchase_entries`, `stock_lots`, etc.). Un `select` directo devuelve 0 filas.
- **Lee** con `compras_workspace()`: proyectos sin precio de venta, línea de base ni avance; solo líneas de **materiales**; compras, stock, pedidos del taller, precios de materiales, estados de línea y umbrales de alertas.
- **Escribe** solo con `compras_save(p)` (`supabase/migrations/20261018120000_lote5c_compras.sql`). La función:
  - exige un usuario activo de Compras o Administrativo (`private.my_buy_org()`);
  - trabaja siempre sobre la empresa del usuario;
  - **calcula el total** de la compra (no lo toma del navegador) y completa quién la cargó;
  - valida cantidad y precio > 0, proyecto de la empresa, proyecto ni en Cotización ni cerrado;
  - un sobrante hereda el costo de su lote (no se puede inventar un costo);
  - **no permite** registrar consumo ni desperdicio (eso lo carga el taller);
  - solo cambia estados de líneas de **materiales**;
  - solo resuelve o cancela pedidos del taller que estén abiertos.
- **Jefe de planta y Operario** no pueden llamar a `compras_save` ni leer `purchase_line_status`.
- Tests: `tests/db/lote5c.test.ts` (Postgres real con PGlite).

## Qué quedó para después

- **Adjuntar facturas y mandar mails a proveedores:** no se hace todavía. Los archivos tienen una brecha de seguridad conocida en Storage: las políticas de Storage **no se pueden cambiar con una migración** (la tabla es de Supabase) y siguen permitiendo a cualquier miembro de la empresa leer y subir archivos del proyecto. Ver `docs/SEGURIDAD.md` → "Archivos (Storage), sigue pendiente" para cambiarlas a mano desde el panel de Supabase antes de sumar facturas.
- La validación de saldos del libro de stock (no mover más de lo que hay) la hace la app, igual que para el Administrativo; la base garantiza que el libro solo crece.

## Archivos

- `lib/purchasing.ts`: líneas, estados, consolidado, qué comprar, compras sobre presupuesto, alertas, historial, precios por proveedor y cotizador de materiales (funciones puras, con tests en `tests/lote5c-compras.test.ts`).
- `lib/supabase/compras.ts`: arma el argumento de `compras_save` comparando el estado antes y después.
- `components/purchasing/`: pantallas de Compras. `components/budget/material-rows.tsx`: filas de materiales compartidas con el Cotizador.
- Tests de pantallas: `tests/lote5c-pantallas.test.tsx`.
