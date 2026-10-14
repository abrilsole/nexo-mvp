# ¿Qué pasa si el proyecto se alarga? (Lote 4c)

> **Hipótesis a validar con el cliente.** Es un cálculo simple con lo que carga el usuario. No es una predicción.

## Cómo funcionaba antes

- El costo de un día de atraso era el costo promedio de un día de trabajo: mano de obra en horario normal dividida por los días de trabajo estimados.
- El piso era la rentabilidad total del precio sugerido.
- No había multa ni piso editable, y la jornada era un campo de cada cotización.

## Método nuevo

| Símbolo | Qué es | De dónde sale |
|---|---|---|
| P | Precio de venta | El que se elige en la cotización |
| C | Costo presupuestado | Total de la cotización (incluye el gasto financiero de ese precio) |
| N | Operarios previstos | El rubro con más operarios de la cotización (el equipo más grande) |
| J | Jornada del operario | Configuración → Tarifas y horas (9,5 h por defecto) |
| t | Tarifa de mano de obra | Configuración → Tarifas y horas |
| m | Multa o costo por día | Lo carga el usuario (opcional, 0 por defecto) |
| r_min | Piso de rentabilidad | Editable; por defecto, la rentabilidad total del precio sugerido |

```
c_dia = N × J × t + m
C(d)  = C + d × c_dia
G(d)  = P − C(d)
R(d)  = G(d) / P                         (ganancia sobre el precio de venta)
Puntos de rentabilidad por día = c_dia / P × 100
d_max  = ⌊ (P − C − r_min × P) / c_dia ⌋  (0 si ya está por debajo del piso; sin dato si c_dia = 0)
d_cero = (P − C) / c_dia                 (punto de equilibrio)
```

- El gasto financiero es un % del precio: no cambia con los días.
- **Caso conocido (test):** P = 1.000.000, C = 700.000, N = 2, J = 9,5, t = 19.000, m = 0. Da c_dia = 361.000, R(0) = 30,0 % y R(1) = −6,1 %.
- La función pura es `delayAnalysis` en `lib/delay.ts`. Los tests están en `tests/lote4c-calculos.test.ts`.

## Supuestos a confirmar

- Los días de atraso los trabaja el mismo equipo previsto (N = el rubro con más operarios).
- No se agregan horas de diseño ni de administración.
- **Blerp no conoce los costos fijos de la empresa** (alquiler, estructura, sueldos fijos) y el cálculo no los incluye. La pantalla lo dice.
- La multa o el costo por día es un importe que carga el usuario: Blerp no lo saca del contrato.

## En pantalla

- Aparece cuando hay precio de venta y costo.
- **Frase principal:** "Cada día de atraso cuesta $X, Y puntos de rentabilidad. Soporta hasta N días antes de bajar de Z%."
- **Tabla de escenarios:** +0, +3, +5, +10 y +15 días hábiles, con costo, ganancia y rentabilidad.
- **Gráfico:** rentabilidad contra días, con la línea del piso y la de ganancia cero.
- **ⓘ "Cómo se calcula":** la fórmula con los números de esa cotización y los supuestos.
