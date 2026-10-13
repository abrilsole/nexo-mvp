# Cotización por rubros (Lote 4)

**Estado:** 13 de octubre de 2026. Surge del feedback de un fabricante piloto que cotiza con una planilla de costeo por producto terminado, dividida por rubros. **Lo que dijo el cliente son hipótesis, no hechos validados.** Todo lo marcado "a confirmar" está pensado para revisarlo con él.

## 1. Rubros (catálogo cerrado)

| Rubro | Tiene | Categoría de reporte |
|---|---|---|
| Carpintería madera, Carpintería metálica, Plásticos, Vidrios, Instalación eléctrica, Pintura / Laqueados, Herrajes, Gráficas, Insumos, Embalaje, Montaje | Materiales + operarios × horas por operario + horas administrativas / diseño | Materiales · Mano de obra · Administración y diseño |
| Transporte / Fletes | Solo un importe | Transporte y fletes |
| Imprevistos | Solo un importe | Imprevistos |

- Se agregan y se quitan solo desde el catálogo (`lib/rubros.ts`), no con texto libre.
- Un material comprado hecho (o cortado afuera) es una línea con cantidad 1 y el costo total.
- La mano de obra se carga como **cantidad de operarios y horas por operario**, sin nombres: el jefe de planta asigna personas después (Lote 5). Las funciones de capacidad por operario del Lote 3 (`lib/capacity.ts`) quedan para eso.
- **Plantillas por producto terminado (más adelante):** un rubro es un dato plano (`RubroRow` / `QuoteRubro`: rubro, materiales, operarios, horas, horas administrativas, importe). Una plantilla sería guardar una lista de rubros y cargarla en `CalcState.rubros`, sin rehacer nada.

## 2. Categorías de reporte

Reemplazan a las siete anteriores en todas las pantallas, alertas, tablas de desvío, glosario y datos demo:

**Materiales · Mano de obra · Administración y diseño · Transporte y fletes · Gasto financiero · Imprevistos.**

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
| — | Administración y diseño (nueva) | — |
| — | Gasto financiero (nueva) | — |

- La conversión la hizo la migración `20261013120000_lote4_rubros.sql` con `UPDATE` (sin DROP): solo cambia la etiqueta de categoría y agrega el rubro. **Verificado en la base del 13/10/2026:** antes y después hay 431 líneas de costo presupuestado por $ 285.044.758,10 y 158 costos reales por $ 82.021.000. Quedaron 57 líneas sin rubro (horas genéricas y una tercerización sin pista en la descripción).
- También se convirtió el presupuesto base congelado (JSON) de cada proyecto, incluidos los cerrados.
- La app aplica el mismo mapeo al leer (`normalizeCategory`), por si la versión publicada anterior escribe categorías viejas antes del merge. Hay un test que compara el mapeo de la base con el de la app.
- **D1** (horas de Instalación → categoría Instalación) queda reemplazada: ya no existe esa categoría.
- **Costos reales:** el registro "Uso de máquinas" ya no se ofrece (va dentro de las horas). Se agregó "Gasto de administración o financiero", que se imputa en la categoría que se elige.
- **Datos demo:** se regeneraron con las categorías nuevas y un rubro por línea. Para mantener el caso de P-1042 (proyectado ≈ 31%, En riesgo por Materiales), el laqueado tercerizado pasó de $ 600.000 a $ 750.000: al juntar Tercerizaciones con Materiales, sin ese cambio el proyecto quedaba en Atención.

## 3. Tarifas por tipo de hora

- Tabla `hour_rates` (id, nombre, tarifa, categoría). Hoy: **Mano de obra $ 19.000** y **Administrativa / diseño $ 27.000** (las del cliente, editables en Configuración). Para sumar otro tipo de hora alcanza con otra fila (la categoría dice si es Mano de obra o Administración y diseño).
- La cotización valoriza las horas con la tarifa del tipo de hora y **la guarda congelada**: cada línea de horas lleva `unit_cost` (tarifa vigente) y `hour_rate_id`. Cambiar la tarifa después no modifica cotizaciones ni proyectos ya creados.

### Tarifa presupuestada vs. costo real (a decidir con el cliente)

- **Presupuesto:** horas × tarifa del tipo de hora (por ejemplo $ 19.000).
- **Costo real:** sin cambios en este lote. Las horas cargadas desde Taller se valorizan con el costo por hora **de cada operario** (`operators.hourly_cost`), congelado en cada registro.
- Consecuencia: si la tarifa presupuestada es distinta del costo por hora de los operarios, aparece desvío en Mano de obra aunque se trabajen exactamente las horas previstas. Opciones para charlar: (a) que la tarifa sea el costo promedio de la planta y el desvío muestre la diferencia de mezcla de operarios; (b) valorizar también lo real con la tarifa (el desvío pasa a ser solo de horas); (c) que la tarifa incluya cargas y estructura y comparar contra un costo real con el mismo criterio.

## 4. Precio sugerido y rentabilidad separada (a confirmar)

Rentabilidad = ganancia sobre el precio de venta, como siempre.

```
Precio sugerido = ( Materiales / (1 − rentabilidad materiales)
                  + Mano de obra y administración / (1 − rentabilidad mano de obra)
                  + Transporte + Imprevistos ) / (1 − % gasto financiero)
```

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

## 7. Qué quedó afuera

- Etapas del proyecto, formulario de horas de Taller y roles (jefe de planta, compras): Lote 5.
- Excel, Google Sheets, dashboards y mails: dependen de archivos que el cliente todavía no pasó.
- Plantillas por producto terminado: el modelo ya lo permite (punto 1), pero no hay pantalla.
- Desvío por rubro en pantalla: el dato ya se guarda.
- Costo real de horas administrativas desde Taller: hoy se carga desde Gestión como "Gasto de administración o financiero".
