# Planta, "Mi día" y desvío de horas (Lote 5B)

## Circuito

1. **Asignación.** El Jefe de planta (o un Administrativo) asigna operario × proyecto × rubro × día, con las horas previstas.
   - Pantalla: Jefe de planta → Asignaciones.
   - El operario pasa al equipo del proyecto.
2. **Carga del operario.** En "Mi día" el operario ve sus asignaciones precargadas y solo confirma o corrige las horas.
   - Si hizo otra cosa: "Agregar otro trabajo" (proyecto → rubro → horas).
3. **Desvío.** Si las horas cargadas superan las previstas por el umbral, aparece una alerta.
   - La ven el Jefe de planta y el Administrativo. El Operario no la ve.
   - Se puede rastrear hasta los registros de horas ("De dónde sale").
4. **Horas.** El Administrativo ve, en la sección Horas, las estimadas contra las reales:
   - por operario, por rubro y por proyecto;
   - con la diferencia, el % y el costo de esas horas.

## Reglas

- **Las horas se cargan por rubro** del proyecto, igual que estima el Cotizador. Si el cliente pide cargar por producto, se resuelve después.
- **Validaciones al cargar:**
  - las horas tienen que ser más de 0;
  - máximo 24 h por persona y día (bloquea; también lo controla la base);
  - si la suma del día pasa la jornada de Configuración, avisa pero no bloquea;
  - la fecha es hoy por defecto y no puede ser futura.
- **Costo:** cada hora queda con el costo vigente ese día, con la lógica de vigencia del Lote 5A. El operario nunca lo ve.
- **Carga del día y horas extra:** se usa la misma regla del Cotizador (`splitOvertime`, `lib/capacity.ts`).
  - Lo asignado hasta la jornada es horario normal; lo que pasa la jornada son horas extra.
  - El operario aparece marcado como sobrecargado.
- **Pendientes de asignar:** rubros donde el presupuesto pidió N operarios y hay menos asignados de hoy en adelante.
  - Se ordenan por fecha de entrega.
  - Los operarios pedidos salen de la línea de mano de obra del Cotizador (`budget_lines.workers`; en cotizaciones viejas, del texto "(2 operarios × …)").

## Desvío de horas (supuesto a ajustar con el cliente)

- **Umbral:** avisa si las horas reales superan las previstas en **25 % o en 2 h, lo que ocurra primero**. Se configura en Configuración → Alertas.
- **Del día:** horas previstas en las asignaciones contra todas las horas que el operario cargó ese día en ese proyecto y rubro.
  - Ejemplo de la demo: ayer Juan tenía 4 h previstas en P-1042 y cargó 9 h (+5 h, +125 %).
- **Acumulado:** horas estimadas del rubro en el presupuesto contra todas las horas cargadas en el rubro.
- **Otras alertas de planta:**
  - operario con más horas asignadas que la jornada en un día;
  - rubro sin operarios asignados a pocos días de la entrega (los días de "Entrega próxima" de Configuración).

## Quién ve qué

| | Administrativo | Jefe de planta | Operario |
|---|---|---|---|
| Asignaciones | Todas (y las edita) | Todas (y las edita) | Solo las suyas |
| Horas estimadas por rubro | Sí | Sí (sin costo) | No (solo el nombre del rubro) |
| Horas cargadas | Sí, con costo | Sí, sin costo | Solo las suyas, sin costo |
| Alertas de desvío | Sí | Sí | **No** |
| Sección Horas (con costos) | Sí | No | No |

En la base:

- `work_assignments`: la leen Administrativo y Jefe de planta. Se escribe solo con `planta_save_assignment` y `planta_remove_assignment`. Quitar una asignación la marca con `removed_at`, no borra la fila.
- `planta_workspace()`: trae asignaciones, la mano de obra por rubro sin importes y la jornada.
- `taller_workspace()`: trae las asignaciones del operario, los rubros de sus proyectos (solo el nombre) y su jornada.
- Tests: `tests/db/lote5b.test.ts` y `tests/lote5b-planta.test.ts`.

## Demo

- **Asignaciones de esta semana** para Juan y Diego.
- **Ayer, Juan:** 4 h previstas y 9 h cargadas, así que hay desvío.
- **Hoy, Diego:** 12 h asignadas con una jornada de 9,5 h, así que hay horas extra.
- **Rubros sin asignar** en P-1039, P-1047, P-1053 y P-1051.
- **Para ver el circuito completo:**
  1. Como Operario, confirmá horas distintas a las previstas.
  2. Como Jefe de planta, mirá las Alertas.
  3. Como Administrativo, mirá Horas.
