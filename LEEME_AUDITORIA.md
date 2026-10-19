# Blerp — entrega de auditoría y correcciones

Esta entrega conserva el stack y el diseño general del ZIP original. No se ejecutaron cambios sobre una base real. Es una versión para validar en un entorno de prueba; las pruebas locales no sustituyen la aceptación con usuarios y sesiones reales.

## Qué se encontró y qué cambió

| Prioridad | Hallazgo comprobado en código | Corrección |
|---|---|---|
| P0 | La escritura remota quedaba en segundo plano respecto de la confirmación de la interfaz. | Acciones confirmadas esperan persistencia; errores visibles, reconciliación con servidor y bloqueo de nuevas acciones mientras se confirma. |
| P0 | Lecturas tardías podían reemplazar estado más reciente; otras sesiones quedaban desactualizadas. | Protección por revisión y organización, actualización al recuperar foco/conexión y cada 30 segundos. |
| P0 | La validación diaria podía considerar un solo proyecto. | Límite de 24 h sobre toda la jornada; servidor serializa por operario. Reintentos de horas con identificador estable. |
| P0 | Cambios relacionados de un proyecto se persistían por separado. | RPC transaccional para cambios de proyecto y stock, control de versión y carga manual de asignación+horas atómica. |
| P0 | `member` implicaba acceso económico completo. | Permiso comercial explícito, control en servidor y edición reservada al propietario. Ver limitación de Administración debajo. |
| P1 | Faltaba redistribución supervisada y auditada. | Alerta por concentración de horas, confirmación de revisión y corrección atómica entre asignaciones del mismo operario y día. Historial original, autor, fecha y motivo en base. |
| P1 | Aprobado permitía planificar pero no siempre ejecutar; diseño no tenía clasificación completa. | Horas desde Aprobado, actividades en paralelo y tipo de horas producción/diseño/administración con tarifa de la fecha. |
| P1 | Asociar compras solamente por material podía repetir costos entre líneas de presupuesto. | Asociación por línea de orden y línea presupuestada; compras sin línea identificadas separadamente. |
| P1 | Una proyección basada sólo en el mayor entre presupuesto y real podía ocultar trabajo pendiente. | Se incorpora cantidad pendiente identificable, con piso de presupuesto/costo real y regla transparente; no es una predicción estadística. |
| P2 | Una carga parcial daba por terminada la asignación y los accesos secundarios apuntaban al primer proyecto. | Taller permite agregar horas y abre materiales/incidencias del proyecto elegido. |

Ya existían cotización por rubros, márgenes diferenciados, productos, planificación, órdenes consolidadas, recepciones parciales, movimientos de stock y valorización histórica. Se reutilizaron. Comprar/facturar sigue separado de consumir: el costo de materiales del proyecto proviene de consumo y desperdicio. Una diferencia entre factura y líneas se informa, sin repartirla automáticamente.

## Instalación y migraciones

1. Descomprimir, ejecutar `npm ci` y configurar `.env.local` a partir de `.env.example`, con las credenciales públicas del entorno de prueba. No poner claves privadas en variables `NEXT_PUBLIC_*`.
2. Antes de aplicar SQL, comparar el historial real de migraciones de ese entorno con `supabase/migrations/` y revisar la documentación existente de instalación. Este ZIP no permite conocer qué está aplicado en la base desplegada.
3. Respetar los prerrequisitos originales y la operación manual existente `supabase/manual/20261016120100_lote5a_manual.sql`, en su posición cronológica. No volver a ejecutar migraciones aplicadas ni funciones de reinicio de datos.
4. Las cuatro migraciones nuevas, en orden, son:
   - `20261022120000_confiabilidad_horas.sql`
   - `20261022121000_permiso_comercial.sql`
   - `20261022122000_tipo_horas.sql`
   - `20261022123000_guardado_atomico.sql`
5. Validar primero en una copia de prueba con respaldo. Estas migraciones agregan tablas/permisos y reemplazan funciones y validaciones; no ejecutan un reinicio de la organización. El archivo de permisos conserva la definición de la función de reinicio existente, pero no la invoca.
6. El propietario debe revisar los permisos comerciales. Los miembros existentes conservan inicialmente su acceso para evitar una revocación masiva; las altas posteriores parten sin permiso comercial. Configurar tarifas históricas válidas de diseño/administración antes de registrar esas horas.
7. Ejecutar `npm run dev`. Para la compilación: `npm run build` y `npm start`.

El frontend actualizado depende de las migraciones nuevas: no desplegar solamente el frontend sobre un esquema anterior.

## Resultados ejecutados

| Comando | Resultado |
|---|---|
| `npm test` | 490 tests aprobados en 39 archivos |
| `npx vitest run tests/db` | 119 tests aprobados en 6 archivos; son un subconjunto del total anterior |
| `npm run lint` | Aprobado |
| `npm run typecheck` | Aprobado |
| `npm run build` | Aprobado |

Los logs están en `docs/validacion/`. La integración SQL usa PGlite, con políticas y funciones del repositorio y simulación de identidades. Los tests de persistencia simulan transporte remoto. No se conectó un Supabase desplegado ni se hicieron pruebas de navegador/dispositivos reales. No se afirma cobertura E2E de interfaz.

Se agregaron casos para confirmación/reintentos, reconciliación, corrección 8→3+5, permisos, carga manual atómica, clasificación de diseño, compra consolidada, proyección y consumo. También se ajustaron expectativas antiguas que bloqueaban ejecución desde Aprobado y una prueba de calendario que confundía una guardia de fin de semana con un día no laborable.

## Guía breve de aceptación A–I

Usar dos proyectos aprobados A/B, un tercero C para compras, un operario, tarifas conocidas y cuentas separadas de Operario, Planta, Compras, Administración restringida y propietario. Abrir navegadores o perfiles diferentes. Esta lista es para ejecutar en staging: no está marcada como validación de interfaz ya realizada.

| Caso | Recorrido y resultado esperado |
|---|---|
| A | Asignar una tarea y cargar 9 h desde Taller. Recargar; comprobar 9 h en Taller, Planta, resumen administrativo y costo económico una sola vez para usuario autorizado. |
| B | Asignar A=3 h y B=5 h el mismo día. Cargar 8 en A. Abrir revisión de horas en Planta; redistribuir a 3 y 5 con motivo. Comprobar ambos proyectos, costos, alerta y auditoría `hours_corrections`. |
| C | Repetir 8 en A, pero confirmar que la carga es correcta. Debe quedar revisada sin modificar las horas. Un cambio posterior en las asignaciones/registros debe volver a permitir revisión. |
| D | Crear una orden con materiales de A/B/C, registrar importes y dos recepciones parciales. Cada línea conserva su proyecto; ninguno recibe el total de la orden. |
| E | Comprar y recibir 12 unidades a $50.000; consumir 9, desperdiciar 1 y mantener 2 reutilizables. Compra $600.000; costo por consumo/desperdicio $500.000; remanente $100.000. |
| F | Comprobar vistas y consultas autenticadas: Taller/Planta sin costos, Compras sólo importes permitidos, Administración restringida sin rentabilidad, propietario autorizado. Intentar lectura de otra empresa y autoasignación del permiso: deben fallar. |
| G | Mantener dos sesiones abiertas; guardar en una y volver al foco de la otra o esperar el refresco de 30 s. Los datos deben converger. |
| H | Desconectar/red rechazada, guardar, repetir clic y reconectar. Sin éxito anticipado ni duplicados. Si la escritura ya fue confirmada pero falla la lectura posterior, se informa que se guardó y se exige actualizar antes de seguir. |
| I | Desde Aprobado asignar diseño y producción, registrar ambas horas y gestionar una compra sin forzar la etapa Compras. Verificar categorías y tarifas históricas. |

## Límites y pendientes explícitos

- **Administración sin permiso comercial no está completamente resuelta:** actualmente reutiliza las vistas de Planta y no puede crear proyectos/cotizar. Separar esas operaciones de los datos económicos requiere completar un contrato de datos y permisos específico; no se ofrece como función terminada.
- La auditoría de correcciones se conserva en tablas; todavía no hay una pantalla dedicada para consultar todo el historial.
- La estrategia entre sesiones es refresco periódico/al foco, no actualización instantánea. Falta validación con Supabase alojado, autenticación real, celulares y pérdida efectiva de red.
- La protección transaccional añadida cubre los recorridos indicados. No se certifica atomicidad global de todas las configuraciones históricas, tarifas ni de todos los flujos secundarios heredados.
- La proyección utiliza cantidades presupuestadas y consumidas identificables y tarifas/precios conocidos. No modela completitud formal de cada costo ni prueba que un cero sea definitivo; las advertencias de costos faltantes deben revisarse antes de interpretar la rentabilidad como final.
- La corrección redistribuye un registro entre asignaciones existentes del mismo operario y fecha. No cambia libremente jornadas/personas ni elimina historial.

Para validar con Luigi y otras empresas: umbral útil de desvío y momento de reclamar horas faltantes; quién confirma/corrige; tipos de horas y tarifas históricas; qué puede cotizar un administrativo sin permiso comercial; cómo registrar diferencias de factura; y si la estimación de cantidades pendientes refleja los trabajos reales. Medir en celular si una carga habitual se completa en menos de 30 segundos.
