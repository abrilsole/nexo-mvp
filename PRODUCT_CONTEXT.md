# Blerp (antes NEXO) — Contexto de producto (tesis)

## Contexto de tesis

Somos estudiantes de la Licenciatura en Gestión de Negocios y Tecnología del ITBA. La metodología de la tesis sigue estos pasos:

1. Detectar un problema real de negocio.
2. Investigarlo y validarlo con empresas.
3. Identificar un segmento.
4. Diseñar una solución digital.
5. Construir un MVP.
6. Probarlo con usuarios reales.
7. Validar **Problem–Solution Fit**.
8. Recién después, investigar la disposición a pagar.

**Blerp es una herramienta de investigación y validación.** No afirmamos haber alcanzado Product-Market Fit. Las reglas del producto son decisiones de diseño todavía no validadas con fabricantes, y el modelo de predicción es un objetivo futuro que hoy no existe.

## Segmento (hipótesis)

PyMEs argentinas que fabrican por proyecto: muebles a medida, mobiliario comercial y corporativo, equipamiento para locales, exhibidores, stands, carpintería a medida.

Hipótesis de *early adopter*, a validar y no presentada como un hecho:

- Entre 5 y 50 empleados.
- Varios proyectos simultáneos, cada uno con su propia cotización.
- Uso intensivo de materiales, mano de obra, trabajos comprados hechos, montaje y fletes.
- Desperdicios y sobrantes.
- Gestión en Excel, Google Sheets o sistemas fragmentados.

## Hipótesis de problema

Existe una brecha entre **lo que pensamos que iba a pasar** (cotización) y **lo que realmente pasó** (ejecución). Parte de lo que ocurre en la ejecución queda sin registrar, se registra tarde o queda disperso en planillas, facturas, WhatsApp o la memoria del jefe de planta. Por eso el margen real se conoce tarde, o no se conoce.

## Evolución: de stock a rentabilidad

La investigación empezó por **stock, materiales y sobrantes**. En las entrevistas observamos:

- Compras hechas específicamente para un proyecto.
- Materiales repartidos en distintos sectores.
- Un conocimiento del stock que depende de la memoria de las personas.
- Sobrantes reutilizables que no siempre quedan registrados.
- Compras imputadas completas a un proyecto aunque parte del material quedara disponible.
- Consolidaciones manuales hechas después para entender los costos.

Eso llevó a una pregunta más importante que “¿cuánto stock tengo?”: **“¿Cuánto terminó costando realmente este proyecto? ¿Estoy ganando lo que pensé?”**

## Presupuesto vs. real no es la innovación

Comparar presupuesto contra real ya lo hacen ERPs, MRPs y herramientas de *job costing*. Nuestra hipótesis más interesante es que **el problema difícil está antes: capturar qué ocurrió realmente en la fábrica**. El dashboard es fácil; capturar el mundo real es lo difícil. Por eso el MVP separa:

- **Modo Taller**: registrar el mundo físico en menos de 30 segundos (“usé 2 placas, 0,2 fueron desperdicio, quedó 0,3 reutilizable”), sin precios ni márgenes.
- **Modo Gestión**: el sistema traduce eso a costo, desvío e impacto en la rentabilidad.

## Compra vs. consumo

Distinguimos siempre:

- Material presupuestado.
- Material comprado o asignado.
- Material tomado de stock existente.
- Material proveniente de sobrantes.
- Material consumido.
- Desperdicio.
- Sobrante reutilizable.
- Costo imputable al proyecto.

Ejemplo: se compran 12 placas ($ 600.000), se consumen 9, se desperdicia 1 y quedan 2 reutilizables. **El costo imputable es $ 500.000, no $ 600.000.** Registrar una compra no cambia el margen; registrar el consumo o el desperdicio sí.

## Captura: mundo físico → dato → costo → rentabilidad

- El operario entra desde su celular y ve solo los proyectos que tiene asignados.
- El operario elige el material, el origen y las cantidades.
- El sistema valoriza con reglas explícitas (el consumo se valoriza al costo del lote del que sale) y guarda de dónde salió el precio.
- Gestión ve el efecto sobre el costo real hasta hoy, la rentabilidad proyectada, las alertas y la actividad (quién, qué y cuándo).

## Propuesta de valor (provisoria)

> “Conocé la rentabilidad esperada al cotizar y detectá durante la fabricación si el proyecto está dejando de ser rentable.”

> “Conectamos lo que presupuestaste con lo que realmente ocurre en fábrica para que puedas entender y proteger la rentabilidad de cada proyecto.”

## Qué queremos validar con el MVP

- ¿Entienden la propuesta?
- ¿Aporta valor ver el presupuesto contra lo real y la rentabilidad **proyectada**, no solo el final?
- ¿Las alertas son útiles o generan ruido?
- ¿Quién debería registrar? ¿Qué es realista registrar y qué no quieren registrar?
- ¿Registrarían desde el celular durante la producción?
- ¿Separarían compra de consumo en su operación real?
- ¿Tiene valor identificar sobrantes reutilizables?
- ¿Cambiarían su Excel por una herramienta así? ¿Qué falta?

## Qué NO afirmamos

- No afirmamos Product-Market Fit.
- El rango de 5 a 50 empleados es una hipótesis.
- Los números de la demo son ficticios (Madera Sur S.R.L.) y no provienen de ninguna empresa entrevistada.
- Los “aprendizajes” del historial son reglas simples sobre pocos casos: son indicios, no conclusiones estadísticas.
- Todavía no investigamos la disposición a pagar.

## Referencia conceptual de sistemas existentes

Entrevistamos a una empresa de mobiliario muy digitalizada. Su proceso va de la consulta y la cotización a la aprobación, la minuta, las compras, la oficina técnica, la producción, la logística e instalación, el cierre y la rentabilidad, con software especializado de corte y optimización. **No copiamos su producto, su diseño ni su propiedad intelectual.** La usamos solo como referencia conceptual:

1. El proyecto es la unidad central.
2. Cada proyecto tiene un estado.
3. Toda la información está conectada al proyecto.
4. El sistema muestra excepciones.
5. Las alertas dirigen la atención, así nadie depende de acordarse qué revisar.
6. Al cerrar un proyecto se puede reconstruir qué pasó.

Esa empresa tiene una infraestructura mucho más compleja que nuestro target, y el MVP no intenta replicarla.

## Por qué no queremos un ERP

El stock aparece solo porque ayuda a explicar el **costo real y la rentabilidad**. Quedan explícitamente afuera:

- Contabilidad, facturación, ARCA, payroll, RRHH, CRM, bancos y pagos.
- Órdenes de compra complejas y gestión de proveedores.
- Múltiples depósitos, transferencias, FIFO/LIFO, stock mínimo, lotes y códigos de barra empresariales.
- Planificación de producción, nesting, CNC e IA generativa.

Convertir Blerp en un ERP diluiría la hipótesis que queremos testear (la captura del mundo físico conectada a la rentabilidad) y aumentaría la fricción de adopción en PyMEs que hoy trabajan con planillas.

## Glosario (una palabra, un significado)

Rentabilidad = ganancia sobre el precio de venta: (precio de venta − costo) / precio de venta. Antes se llamaba "margen"; la fórmula no cambió.

| Término | Significado |
|---|---|
| Costo presupuestado | Lo que se calculó que va a costar el proyecto. |
| Precio de venta | Lo que se le cobra al cliente. |
| Presupuesto base (línea base) | El costo presupuestado aprobado y congelado. No se dice "presupuesto" suelto. |
| Rentabilidad objetivo | La ganancia sobre el precio de venta que se busca al cotizar. Con ella el Cotizador sugiere un precio. |
| Rentabilidad esperada | Sale del presupuesto base: (precio de venta − costo presupuestado) / precio de venta. |
| Rentabilidad proyectada | Costo real hasta hoy + lo que falta del costo presupuestado. Es un cálculo por reglas, no una predicción. |
| Rentabilidad real final | Solo existe al cierre, en proyectos finalizados. |
| Etapa | Cotización, Aprobado, Compras, Producción, Instalación, Finalizado. |
| Disponible | Solo lo libre en depósito. |
| Asignado a este proyecto | Lo que el proyecto tiene para usar (lo que ve Taller). |
| Costo real hasta hoy / Costo real final | El primero solo en proyectos activos; el segundo solo en finalizados. |
| Plazo transcurrido | Tiempo que pasó entre inicio y entrega (no es avance de obra). |
| Puntos de rentabilidad | Diferencia entre dos rentabilidades (nunca "%" ni "pp"). |
| Comprado ≠ Consumido ≠ Desperdicio ≠ Sobrante | Siempre se muestran por separado. Solo consumido + desperdicio es costo. |

Desde el Lote 4 la cotización se arma por **rubros** (Carpintería madera, Carpintería metálica, Plásticos, Vidrios, Instalación eléctrica, Pintura / Laqueados, Herrajes, Gráficas, Insumos, Transporte / Fletes, Embalaje, Montaje, Imprevistos) y se reporta en siete **categorías**, iguales en todas las pantallas: **Materiales, Mano de obra, Diseño, Administración, Transporte y fletes, Gasto financiero, Imprevistos.** El uso de máquina está incluido en la mano de obra. El mapeo de las siete categorías anteriores y los supuestos a confirmar con el cliente están en `docs/DECISIONES_RUBROS.md`.

| Término | Significado |
|---|---|
| Rubro | Sector de la cotización. Cada línea del costo presupuestado guarda su rubro. |
| Tipo de hora / tarifa | Mano de obra, Diseño o Administración, cada uno con su tarifa por hora (Configuración). Cada cotización guarda la tarifa vigente. |
| Días de trabajo estimados | Horas por operario / jornada, sumando los rubros uno detrás de otro (supuesto conservador, a confirmar). |
| Fecha de entrega comprometida | La que se le promete al cliente. Si los días de trabajo no entran, la diferencia se calcula como horas extra. |
| Gasto financiero | % sobre el precio de venta. Es un costo, no un rubro. |

## Decisiones tomadas (oct 2026)

- **D1.** ~~Las horas de la etapa Instalación van a la categoría Instalación~~. Reemplazada en el Lote 4: ya no existe la categoría Instalación; todas las horas van a Mano de obra (el montaje es el rubro Montaje).
- **D2.** Solo se compra desde la etapa Compras.
- **D3.** El consumo se valoriza al costo del lote del que sale.
- **D4.** El mínimo para estimar con el modelo es 10 proyectos comparables (el modelo todavía no existe).
- **D5.** El proyecto referencia un id de cliente.

D2 y D5 se implementan en lotes posteriores.

## Pendientes anotados

- **Lote 2:** el campo "Rol o especialidad" de Operarios hoy es texto libre. Va a pasar a un selector con un catálogo cerrado: Carpintería · Armado · Oficina técnica · Terminaciones · Instalación · Otro.
