# Si el trabajo se alarga (Lote 4c, revisado en Lote 4d)

> **Hipótesis a validar con el cliente.** Es un cálculo simple con lo que carga el usuario. No es una predicción.

## Qué mide

Son **días de trabajo extra** sobre los días de trabajo estimados: el equipo trabaja más días que lo previsto.
No es lo mismo que **entregar tarde**: si el cliente cobra una multa por demora, es un costo aparte que se carga en "Multa o costo por día".

## Cómo funcionaba antes

- Lote 4b: el costo de un día de atraso era el costo promedio de un día de trabajo (mano de obra en horario normal dividida por los días de trabajo estimados). El piso era la rentabilidad total del precio sugerido. No había multa ni piso editable.
- Lote 4c: método actual (abajo), con escenarios fijos de +3, +5, +10 y +15 días y un gráfico.
- Lote 4d: escenarios proporcionales a los días estimados, días con decimales, sin gráfico (llegaba a −700 %).

## Método

| Símbolo | Qué es | De dónde sale |
|---|---|---|
| P | Precio de venta | El que se elige en la cotización |
| C | Costo presupuestado | Total de la cotización (incluye el gasto financiero de ese precio) |
| N | Operarios previstos | El rubro con más operarios de la cotización (el equipo más grande) — **a confirmar con el cliente** |
| J | Jornada del operario | Configuración → Tarifas y horas (9,5 h por defecto) |
| t | Tarifa de mano de obra | Configuración → Tarifas y horas |
| m | Multa o costo por día | Lo carga el usuario (opcional, 0 por defecto) |
| r_min | Piso de rentabilidad | Editable; vacío = la rentabilidad total del precio sugerido |
| D | Días de trabajo estimados | Horas por operario / jornada, sumando los rubros |

```
c_dia = N × J × t + m
C(d)  = C + d × c_dia
G(d)  = P − C(d)
R(d)  = G(d) / P                          (ganancia sobre el precio de venta)
Puntos de rentabilidad por día = c_dia / P × 100
d_max  = (P − C − r_min × P) / c_dia      (con decimales; 0 si ya está por debajo del piso; sin dato si c_dia = 0)
d_cero = (P − C) / c_dia                  (punto de equilibrio)
Escenarios: d = ⌈ D × 25 % ⌉, ⌈ D × 50 % ⌉, ⌈ D × 100 % ⌉, cada uno con mínimo 1 día
```

- El gasto financiero es un % del precio: no cambia con los días.
- **Caso conocido (test):** P = 1.000.000, C = 700.000, N = 2, J = 9,5, t = 19.000, m = 0. Da c_dia = 361.000, R(0) = 30,0 %, R(1) = −6,1 % y d_cero = 300.000 / 361.000 ≈ **0,83 días** (con un día extra ya pierde plata). Con piso 30 %, d_max = 0.
- **Escenarios (test):** con D = 10 días → +3 (2,5 redondeado hacia arriba), +5 y +10 días. Con D = 2 → +1, +1 y +2.
- La función pura es `delayAnalysis` en `lib/delay.ts` (`scenarioDays` para los escenarios). Los tests están en `tests/lote4c-calculos.test.ts` y `tests/lote4d-pantalla.test.tsx`.

## Supuestos a confirmar con el cliente

- Los días extra los trabaja el mismo equipo previsto (N = el rubro con más operarios).
- No se agregan horas de diseño ni de administración.
- **Blerp no conoce los costos fijos de la empresa** (alquiler, estructura, sueldos fijos) y el cálculo no los incluye. La pantalla lo dice.
- La multa o el costo por día es un importe que carga el usuario: Blerp no lo saca del contrato.

## En pantalla

- Sección "Si el trabajo se alarga". Aparece cuando hay precio de venta y costo.
- **Frase principal:** "Cada día de trabajo extra cuesta $X, Y puntos de rentabilidad. Soporta hasta 1,1 días extra antes de bajar de Z%." Los días van con un decimal, redondeados hacia abajo.
- Si no soporta ni un día: "No soporta ni un día extra: ya queda por debajo del piso de Z%." Nunca dice "0 días".
- **Tabla de escenarios:** lo estimado, +25 %, +50 % y +100 % de los días estimados (con cuántos días son), con costo, ganancia y rentabilidad. En rojo, los que quedan debajo del piso.
- Sin gráfico.
- **ⓘ:** qué son los días extra vs. entregar tarde, la fórmula con los números de esa cotización y los supuestos.
