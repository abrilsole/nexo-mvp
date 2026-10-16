# Producción: productos, asignaciones y horas (Lote 6)

Reemplaza la planificación por rubro del presupuesto del Lote 5B (`docs/PLANTA_Y_HORAS.md` queda como historia).

## Modelo

| Concepto | Dónde vive | Quién lo carga |
|---|---|---|
| **Producto** del proyecto (nombre y cantidad, ej. "Silla × 100") | `project_items` (antes "muebles") | Administrativo |
| **Rubros del producto**: horas estimadas para toda la cantidad y operarios pedidos (sin nombre) | `project_items.rubros` | Administrativo |
| **Unidades terminadas** (contador, ej. 40/100) | `project_items.completed_units` | **Solo Jefe de planta** (o Administrativo). El operario no carga ni ve unidades. |
| **Asignación** = producto + rubro + operario + fecha + horas previstas | `work_assignments.item_id` | Jefe de planta (o Administrativo) |
| **Horas** | `actual_entries` | El operario, **siempre contra una asignación suya** |

No puede existir una hora "sin rubro":
- La base rechaza toda hora nueva sin asignación (`guard_labor_assignment`) y completa producto y rubro desde la asignación.
- La carga manual del Administrativo crea la asignación de ese día y carga contra ella.
- Las horas que ya existían en la base no se tocan.

## Estados (funciones puras, `lib/production.ts`)

- **Producto:** Pendiente (0 terminadas y sin horas) · En producción (hay horas o algunas terminadas) · Terminado (terminadas = cantidad).
- **Proyecto (producción):** se deriva de sus productos.
  - Todos terminados: Terminado.
  - Alguno arrancado: En producción.
  - Ninguno arrancado: Pendiente.
- **Avance:** las unidades terminadas de cada producto, ponderadas por sus horas estimadas (una mesa pesa más que una silla).
- **Semáforo de entrega** (supuesto a validar con el cliente):
  - **Atrasado:** venció la entrega y no está terminado.
  - **En riesgo:** el avance va más de 20 puntos detrás del tiempo transcurrido, o faltan los días de "entrega cercana" (Configuración → Alertas) o menos.
  - **En tiempo:** el resto.

## Desvío de horas (`lib/plant.ts`)

- Por **producto + rubro**: horas estimadas contra horas cargadas, con el umbral de Configuración → Alertas (25 % o 2 h, lo que ocurra primero; supuesto).
- **Por operario:** horas previstas en sus asignaciones (las que ya pasaron) contra las que cargó.
  - Resultado: "cumplió", "se pasó X h" o "le faltaron X h".
- **Alerta:** la ven el Administrativo (Alertas) y el Jefe de planta (Resumen y Alertas).
  - Indica proyecto, producto, rubro, operarios y desvío.
  - "De dónde sale" lista cada registro de horas.

## Pantallas

- **Operario, "Mi día":** solo lo asignado a esa persona para hoy. Muestra proyecto, producto, rubro y horas estimadas, un campo de horas y "Guardar".
  - Sin plata, sin otros proyectos y sin unidades.
  - Un link chico, "¿Usaste material o tuviste un problema?", lleva a cargar consumo o una nota.
- **Jefe de planta:**
  - **Resumen:** incluye los desvíos de horas.
  - **Pendientes de asignar:** producto + rubro con menos personas asignadas que las pedidas. Se asignan varias personas en un rango de días hábiles. Cuando todo está asignado, la cola queda vacía.
  - **Proyectos:** por producto, el contador de unidades; por rubro, horas estimadas y cargadas y operarios pedidos/asignados; por operario, cumplió o se pasó.
  - Sin importes.
- **Administrativo, Dashboard:** 4 bloques. Cada número se abre y muestra la lista que lo explica.
  1. **Proyectos:** en tiempo, en riesgo y atrasados.
  2. **Horas y operarios:** cumplimiento de la semana, quiénes se pasaron y quiénes quedaron cortos.
  3. **Margen:** esperado contra proyectado (en curso) y el rubro que más gastó de más.
     - El margen real va aparte y solo para proyectos cerrados: los tres nunca se mezclan.
  4. **Pendientes:** alertas abiertas, compras sin hacer y asignaciones sin cubrir.
- La solapa **Historial** se sacó (ruta, menú y código).

## Demo: la historia de punta a punta

- **Proyecto estrella:** P-1058 "Restaurante Costanera – 10 mesas y 100 sillas".
  - **Mesas:** 10/10, Terminado.
    - En carpintería se estimaron 60 h y se cargaron 74 h: Juan se pasó 14 h y Diego cumplió. Es la única alerta de horas de la demo.
  - **Sillas:** 40/100, En producción.
    - Hoy Juan tiene 8 h de carpintería de sillas en "Mi día".
    - Al embalaje de las sillas le falta un operario (primero en "Pendientes de asignar").
  - **Compras:** el multilaminado está recibido, el caño comprado en parte y el tapacanto cotizando.
- **Atrasado a propósito:** P-1047, que venció hace 2 días.
- **En riesgo:** P-1039, con entrega en 3 días.
- **Fechas:** todas son relativas al día en que se restaura la demo. Con el tiempo se desactualizan: "Restaurar datos demo" las vuelve a poner al día.
