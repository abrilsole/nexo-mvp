# Cotización por rubros (Lote 4)

**Estado:** 15 de octubre de 2026 (Lote 4, 4b y 4c). Surge del feedback de un fabricante piloto que cotiza con una planilla de costeo por producto terminado, dividida por rubros. **Lo que dijo el cliente son hipótesis, no hechos validados.** Todo lo marcado "a confirmar" está pensado para revisarlo con él.

## 1. Rubros (catálogo cerrado)

| Rubro | Tiene | Categoría de reporte |
|---|---|---|
| Carpintería madera, Carpintería metálica, Plásticos, Vidrios, Instalación eléctrica, Pintura / Laqueados, Herrajes, Gráficas, Insumos, Embalaje, Montaje | Materiales + operarios × horas por operario + horas de diseño + horas de administración | Materiales · Mano de obra · Diseño · Administración |
| Transporte / Fletes | Solo un importe | Transporte y fletes |
| Imprevistos | Solo un importe | Imprevistos |

- Se agregan y se quitan solo desde el catálogo (`lib/rubros.ts`), no con texto libre.
- Un material comprado hecho (o cortado afuera) es una línea con cantidad 1 y el costo total.
- La mano de obra se carga como **cantidad de operarios y horas por operario**, sin nombres: el jefe de planta asigna personas después (Lote 5). Las funciones de capacidad por operario del Lote 3 (`lib/capacity.ts`) quedan para eso.
- **Plantillas por producto terminado (más adelante):** un rubro es un dato plano (`RubroRow` / `QuoteRubro`: rubro, materiales, operarios, horas, horas de diseño, horas de administración, importe). Una plantilla sería guardar una lista de rubros y cargarla en `CalcState.rubros`, sin rehacer nada.

## 2. Categorías de reporte

Reemplazan a las siete categorías del Lote 1 (Materiales, Mano de obra, Máquinas, Tercerizaciones, Logística, Instalación, Imprevistos) en todas las pantallas, alertas, tablas de desvío, glosario y datos demo:

**Materiales · Mano de obra · Diseño · Administración · Transporte y fletes · Gasto financiero · Imprevistos.**

(En el Lote 4 eran seis, con "Administración y diseño" juntas; el Lote 4b las separó.)

Cada línea del costo presupuestado guarda su **rubro** (`budget_lines.rubro`), para poder mostrar desvío por rubro más adelante. El gasto financiero no tiene rubro.

### Mapeo de las categorías anteriores

| Categoría anterior | Categoría nueva | Rubro (líneas viejas) |
|---|---|---|
| Materiales | Materiales | Por la descripción (herrajes, vidrios, plásticos, metal, pintura, eléctrico, gráficas, embalaje, insumos); si no hay pista, Carpintería madera |
| Mano de obra | Mano de obra | Por la descripción; si no hay pista, **sin rubro** (no se inventa) |
| Máquinas | Mano de obra (el uso de máquina está incluido en la mano de obra) | Sin rubro |
| Tercerizaciones (y "Terminaciones") | Materiales (es trabajo que se compra hecho) | Por la descripción: laqueado/pintura → Pintura / Laqueados, vidrio → Vidrios, ploteo → Gráficas… |
| Logística | Transporte y fletes | Transporte / Fletes |
| Instalación | Mano de obra | Montaje |
| Imprevistos | Imprevistos | Imprevistos |
| — | Diseño (nueva) | — |
| — | Administración (nueva) | — |
| — | Gasto financiero (nueva) | — |

- La conversión la hizo la migración `20261013120000_lote4_rubros.sql` con `UPDATE` (sin DROP): solo cambia la etiqueta de categoría y agrega el rubro. **Verificado en la base del 13/10/2026:** antes y después hay 431 líneas de costo presupuestado por $ 285.044.758,10 y 158 costos reales por $ 82.021.000. Quedaron 57 líneas sin rubro (horas genéricas y una tercerización sin pista en la descripción).
- También se convirtió el presupuesto base congelado (JSON) de cada proyecto, incluidos los cerrados.
- La app aplica el mismo mapeo al leer (`normalizeCategory`), por si la versión publicada anterior escribe categorías viejas antes del merge. Hay un test que compara el mapeo de la base con el de la app.
- **D1** (horas de Instalación → categoría Instalación) queda reemplazada: ya no existe esa categoría.
- **Costos reales:** el registro "Uso de máquinas" ya no se ofrece (va dentro de las horas). "Diseño", "Administración" y "Gasto financiero" son tarjetas separadas en "Registrar lo que pasó" (se guardan con tipo `other` y su categoría).
- **Datos demo:** se regeneraron con las categorías nuevas y un rubro por línea. Para mantener el caso de P-1042 (proyectado ≈ 31%, En riesgo por Materiales), el laqueado tercerizado pasó de $ 600.000 a $ 750.000: al juntar Tercerizaciones con Materiales, sin ese cambio el proyecto quedaba en Atención.

### Lote 4b: Diseño y Administración por separado

| Línea de "Administración y diseño" | Va a | Tipo de hora |
|---|---|---|
| El tipo de hora es Diseño | Diseño | Diseño |
| La descripción dice "diseño" y no dice "administración" | Diseño | Diseño (si son horas) |
| Cualquier otro caso (incluida "horas administrativas / diseño", que dice las dos cosas) | Administración | Administración (si son horas) |

- La tarifa ya estaba congelada en cada línea (`unit_cost`) y no cambia.
- Mismo criterio para costos reales (por la descripción) y para el presupuesto base congelado.
- La conversión la hizo la migración `20261014120000_lote4b_diseno_administracion.sql` (sin DROP).
- **Verificado el 14/10/2026:** antes y después siguen 431 líneas por $ 285.044.758,10 y 158 costos reales por $ 82.021.000. En la base todavía no había líneas de "Administración y diseño", así que no se movió ninguna. El mapeo está probado con datos de prueba en `tests/db/rls.test.ts`.
- Tipos de hora: "Administrativa / diseño" pasó a llamarse "Administración" y conservó su tarifa. Se agregó "Diseño", que arranca con esa misma tarifa en cada empresa.

## 7. Paso "Revisar y crear" de Nuevo proyecto

De arriba hacia abajo, sin repetir números entre columnas:

1. **Encabezado:** nombre, código, cliente, tipo, inicio y fecha de entrega comprometida.
2. **Resultado:** Precio de venta, Costo presupuestado, Ganancia y Rentabilidad esperadas. Si el precio es el sugerido, debajo va la rentabilidad de materiales y de mano de obra.
3. **Tabla por rubro** (`rubroTable` en `lib/budget-calculator.ts`):
   - Una fila por rubro con importe, con columnas Materiales, Mano de obra, Diseño, Administración y Total.
   - Transporte e Imprevistos van como importe. Los ajustes por historial (sin rubro) van en su propia fila.
   - Gasto financiero va aparte. El total es exactamente el costo presupuestado.
4. **Supuestos:** las tres tarifas, el % de gasto financiero, los días de trabajo estimados (supuesto a confirmar) y si la fecha entra.
5. **Avisos en un solo bloque** (`reviewWarnings`): fecha que no entra con horas extra, precio escrito a mano, falta de precio, de tarifa o de costo.

## 3. Tarifas por tipo de hora

- Tabla `hour_rates` (id, nombre, tarifa, `kind`). Hoy: **Mano de obra $ 19.000**, **Diseño $ 27.000** y **Administración $ 27.000** (las del cliente, editables por separado en Configuración). Para sumar otro tipo de hora alcanza con otra fila (`kind` dice si cae en Mano de obra, Diseño o Administración).
- La columna vieja `category` de `hour_rates` solo aceptaba labor / admin. Cambiar esa regla requería un DROP, así que la categoría pasó a la columna nueva `kind` y `category` quedó en desuso (tiene un valor por defecto y la app no la lee ni la escribe).
- Solo la mano de obra tiene horas extra. Diseño y Administración son horas totales × su tarifa.
- La cotización valoriza las horas con la tarifa del tipo de hora y **la guarda congelada**: cada línea de horas lleva `unit_cost` (tarifa vigente) y `hour_rate_id`. Cambiar la tarifa después no modifica cotizaciones ni proyectos ya creados.

### Tarifa presupuestada vs. costo real (a decidir con el cliente)

- **Presupuesto:** horas × tarifa del tipo de hora (por ejemplo $ 19.000).
- **Costo real:** sin cambios en este lote. Las horas cargadas desde Taller se valorizan con el costo por hora **de cada operario** (`operators.hourly_cost`), congelado en cada registro.
- Consecuencia: si la tarifa presupuestada es distinta del costo por hora de los operarios, aparece desvío en Mano de obra aunque se trabajen exactamente las horas previstas. Opciones para charlar: (a) que la tarifa sea el costo promedio de la planta y el desvío muestre la diferencia de mezcla de operarios; (b) valorizar también lo real con la tarifa (el desvío pasa a ser solo de horas); (c) que la tarifa incluya cargas y estructura y comparar contra un costo real con el mismo criterio.

## 4. Precio sugerido y rentabilidad separada (a confirmar)

Rentabilidad = ganancia sobre el precio de venta, como siempre.

```
Precio sugerido = ( Materiales / (1 − rentabilidad materiales)
                  + (Mano de obra + Diseño + Administración) / (1 − rentabilidad mano de obra)
                  + Transporte + Imprevistos ) / (1 − % gasto financiero)
```

- **Supuesto a confirmar:** el objetivo de rentabilidad de "mano de obra" incluye Diseño y Administración (un solo objetivo para las tres). Si el cliente quiere objetivos distintos para diseño o administración, se suma un tercer objetivo a la fórmula.
- Se redondea hacia arriba al peso.
- Transporte e Imprevistos van al costo sin rentabilidad.
- En pantalla se muestran el precio sugerido, la rentabilidad resultante de materiales, de mano de obra y la total, y la fórmula con los números.
- Si se escribe un precio a mano, se muestra la rentabilidad total y el aviso de que el desglose por tipo solo aplica al precio sugerido. "Usar este precio" toma el sugerido.
- Caso conocido (test): materiales $ 700 al 30% + mano de obra $ 600 al 40% → $ 2.000 (rentabilidad total 35%). Con 5% de gasto financiero → $ 2.106 (33,27%).
- Funciones: `suggestedPrice`, `analyzePrice` en `lib/budget-calculator.ts`.

## 5. Gasto financiero (a confirmar)

- Porcentaje sobre el precio de venta, **5% por defecto**. Se cambia en Configuración (valor inicial de cada cotización) y en el Cotizador (esa cotización).
- Es un costo: aparece como línea "Gasto financiero" en el costo presupuestado (categoría Gasto financiero) una vez que hay precio de venta.
- Si después se cambia el precio de venta del proyecto, la línea queda con el importe calculado al cotizar.

## 6. Días de trabajo, entrega y horas extra (a confirmar)

- **Días de trabajo estimados** = horas por operario / jornada, sumando los rubros **uno detrás de otro**. Es un supuesto conservador: algunas subetapas pueden ir en paralelo.
- **Fecha de entrega comprometida:** opcional en el Cotizador; en Nuevo proyecto es la fecha de entrega del proyecto.
- Si los días de trabajo no entran en los días hábiles hasta la entrega, se avisa y la misma proporción de horas de cada rubro (días disponibles / días necesarios) pasa a horas extra, con la tarifa × el multiplicador de Configuración (2 por defecto). Se muestra el desglose normal / extra por rubro.
- Se eliminaron "Entrega estimada" y "Usar esta fecha", que confundían.

## 8. Lote 4c: una sola pantalla de cotización, plazo y jornada

- **El Cotizador y el paso "Costo presupuestado" de Nuevo proyecto son la misma pantalla** (`QuoteWorkspace`). Solo cambian:
  - el contexto: en Nuevo proyecto se ven código, cliente y entrega;
  - el botón final: "Crear proyecto con esta cotización" o "Continuar".
  - El botón deshabilitado dice por qué ("Cargá al menos un costo." o falta el precio).
- **Sin fechas en el Cotizador.** Las fechas reales se cargan al crear el proyecto. En el bloque "Días de trabajo" hay un único campo opcional, **Plazo (días hábiles)**:
  - con plazo se calculan las horas extra como antes; sin plazo no hay horas extra;
  - en Nuevo proyecto, el plazo de la cotización propone la fecha de entrega (inicio + plazo) y hay un botón "Usar esa fecha", pero no la pisa;
  - si la cotización no tenía plazo, se propone el de las fechas del proyecto.
- **Tipo de proyecto:** es un selector opcional dentro de "Aprendizaje de proyectos anteriores" (lo único que lo usa). En Nuevo proyecto se toma del paso 1.
- **Jornada del operario:**
  - Pasó a Configuración → Tarifas y horas: 9,5 h por defecto, entre 1 y 24 (`cost_settings.hours_per_day`).
  - La usan los días de trabajo, las horas extra, la capacidad y el atraso.
  - La jornada usada queda congelada en cada línea de horas (`budget_lines.hours_per_day`), junto con la tarifa.
- **Resultado ordenado:** primero los tres objetivos con su nombre completo, después el precio sugerido con "Usar este precio" y al final el precio de venta. Los avisos aparecen solo cuando hacen falta.
- **Aprendizaje:**
  - Aparece debajo del Resultado y solo si hay costos.
  - Es una tabla (categoría, desvío promedio, proyectos) con una acción por fila: "Sumar margen de seguridad".
  - Lleva la etiqueta "Datos de demostración" cuando la empresa es demo.
- **El resumen va una sola vez:** días de trabajo y plazo están solo en el panel lateral.
- **Explicaciones largas:** pasaron a una ⓘ accesible (`components/ui/help-tip.tsx`), en toda la app.
- **Atraso:** método nuevo, en `docs/CALCULO_ATRASO.md`.
- **Configuración:**
  - Pestañas: Alertas · Tarifas y horas · Costos · Datos.
  - Un "Guardar" por sección, aviso de cambios sin guardar y "Restaurar valores por defecto".
  - "Restaurar datos demo" solo aparece en una empresa demo (`organizations.is_demo`), y solo en Configuración → Datos.
  - "Cómo se clasifica cada proyecto" pasó a una ⓘ al lado de la columna "Salud" en Proyectos.

## 9. Qué quedó afuera

- Etapas del proyecto, formulario de horas de Taller y roles (jefe de planta, compras): Lote 5.
- Excel, Google Sheets, dashboards y mails: dependen de archivos que el cliente todavía no pasó.
- Plantillas por producto terminado: el modelo ya lo permite (punto 1), pero no hay pantalla.
- Desvío por rubro en pantalla: el dato ya se guarda.
- Costo real de horas de diseño y administración desde Taller: hoy se cargan desde Gestión con las tarjetas "Diseño" y "Administración".
