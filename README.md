# Blerp (antes NEXO) — Rentabilidad por proyecto

MVP de investigación (tesis ITBA, Gestión de Negocios y Tecnología) para PyMEs que fabrican por proyecto: muebles a medida, mobiliario comercial y corporativo, exhibidores, stands.

Núcleo: `presupuesto → ejecución → captura → costo → desvío → rentabilidad`. Son decisiones de diseño todavía no validadas con fabricantes. **No afirmamos Product-Market Fit.** Un modelo de predicción es un objetivo futuro: hoy no existe; todos los cálculos son reglas explícitas.

El nombre de la app sale de una sola constante: `APP_NAME` en `lib/constants.ts`.

> Pregunta que tiene que responder en menos de 10 segundos: **“¿Estoy ganando lo que pensé que iba a ganar? Y si no, ¿por qué?”**

## Problema

Al cotizar, la fábrica estima, rubro por rubro, materiales, horas de mano de obra, horas de diseño y fletes. Durante la ejecución pasan cosas distintas: se usa más o menos material, hay desperdicio, quedan sobrantes, cambian los precios y aparecen horas o compras extra. Esa información suele quedar dispersa (planillas, WhatsApp, facturas, la memoria del jefe de planta), así que el margen real se conoce tarde o no se conoce.

Nuestra hipótesis es que lo difícil **no es el dashboard de presupuesto vs. real, sino capturar lo que pasó en el taller** (mundo físico → dato → costo → margen).

## Producto

- **Modo Gestión** (desktop): pensado para ver rentabilidad, excepciones y desvíos, y decidir.
- **Modo Taller** (mobile, en el celular del operario, solo sus proyectos asignados): registra qué se usó, cuánto, si hubo desperdicio y si quedó sobrante. **No muestra precios ni márgenes.**

Flujo central: `presupuesto → compra → consumo → desperdicio/sobrante → costo imputable → margen proyectado → alertas → cierre → historial`.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind CSS v4 · componentes estilo shadcn/ui (Radix + cva) · Lucide · Recharts · Zustand · Supabase (Postgres + Auth con Google, `@supabase/ssr`) · React Hook Form + Zod · Vitest.

Los datos viven en Supabase (proyecto `nexo`, región São Paulo). El landing es público; el resto pide iniciar sesión con Google.

> Los componentes de `components/ui` siguen el patrón de shadcn/ui (código propio sobre Radix). Se escribieron localmente porque en el entorno de desarrollo el registry de shadcn estaba bloqueado. Si se prefiere, se pueden reemplazar con `npx shadcn add …` sin cambiar el resto de la app.

## Instalación y ejecución

```bash
npm install
cp .env.example .env.local   # completar URL y publishable key de Supabase
npm run dev        # http://localhost:3000
npm test           # tests de dominio (Vitest)
npm run lint
npm run build && npm start
```

## Rutas

| Ruta | Qué es |
|---|---|
| `/` | Landing pública (estática, sin store): propuesta de valor, producto, cómo funciona, piloto y FAQ |
| `/dashboard` | Dashboard: KPIs, “Necesitan atención”, gráfico esperado vs. proyectado, tabla de activos |
| `/projects` | Proyectos: tabs por etapa, búsqueda y filtros por salud y fecha |
| `/projects/new` | Wizard: información → costo presupuestado (con resumen sticky) → resumen |
| `/projects/[id]` | **Detalle** con tabs Resumen · Costo presupuestado · Materiales · Costos reales · Etapas · Muebles y archivos · Actividad, más los diálogos Registrar lo que pasó · Registrar compra · Cambiar etapa · Cerrar |
| `/alerts` | Alertas: Todas · Críticas · Atención · Resueltas |
| `/history` | Proyectos finalizados y aprendizajes |
| `/materials` | Pool simple de sobrantes reutilizables (no es un módulo de stock) |
| `/settings` | Umbrales de alertas, regla de salud del proyecto, reset de la demo y vaciar datos |
| `/login` | Acceso con Google (público) |
| `/taller/[projectId]` | Registro de taller mobile, sin sidebar |

## Arquitectura

```
app/                      rutas (thin wrappers); page.tsx es el landing; (gestion)/ lleva HydrationGate + AppShell, registro/ solo HydrationGate
components/
  ui/                     primitivas (button, card, dialog, tabs, table, choice, field…)
  layout/                 AppShell, HydrationGate, ModeSwitch
  landing/                secciones del landing (server components, sin estado)
  dashboard/ projects/ budget/ materials/ actual-costs/ alerts/ history/ settings/ workshop/ charts/ shared/
lib/
  calculations.ts         cálculos económicos (funciones puras)
  material-reconciliation.ts   filas de materiales + reconciliación
  reusable-pool.ts        pool de sobrantes (puro, inmutable)
  alerts.ts               motor de alertas derivado
  insights.ts             textos determinísticos (sin IA)
  project-operations.ts   operaciones de dominio puras (compra, uso, costos, cierre…)
  activity.ts             mensajes de actividad (quién / qué / cuándo)
  schemas.ts              validación Zod
  seed-data.ts            empresa demo Madera Sur S.R.L.
  landing-content.ts      textos del landing (sin testimonios, logos ni precios inventados)
  constants.ts            nombre de la app, labels, catálogo, umbrales, semántica de color
  supabase/               clientes (browser/server), proxy de sesión, mappers y lectura/escritura del workspace
  formatting.ts           es-AR, ARS, dd/mm/yyyy, puntos de rentabilidad, días
store/
  use-app-store.ts        Zustand: estado en memoria + cola de escrituras a Supabase
  selectors.ts            hooks derivados memoizados
types/index.ts            modelo de dominio
tests/                    cálculos, reconciliación, alertas y escenarios de la demo
```

**Para migrar a una API o base de datos**, se reemplazan las acciones de `store/use-app-store.ts` por llamadas remotas. `lib/` y `types/` no cambian, porque todas las reglas económicas son funciones puras que reciben datos y devuelven datos.

## Supabase y login con Google

- **Schema**: `supabase/migrations/20261003190000_init.sql` (ya aplicado al proyecto). Cada usuario pertenece a una empresa (`organizations` + `organization_members`); un trigger crea la empresa en el primer login. Todas las tablas tienen RLS: solo los miembros de la empresa leen y escriben sus datos.
- **Sesión**: `proxy.ts` refresca la sesión en cada request y manda a `/login?next=…` si una ruta privada se pide sin sesión. Públicas: `/`, `/login`, `/auth/callback`.
- **Flujo**: Landing → “Acceder” → `/login` → Google → `/auth/callback` (intercambia el código por la sesión) → `/dashboard`.
- **Store**: la UI sigue usando las mismas acciones síncronas; el store aplica las operaciones puras en memoria y encola la escritura en Supabase de lo que cambió (`lib/supabase/workspace.ts`). Si una escritura falla, aparece un aviso.

Para que Google funcione hay que configurarlo una vez:

1. Google Cloud Console → *APIs & Services → Credentials* → crear un **OAuth client ID** (tipo *Web application*). En *Authorized redirect URIs* agregar `https://ijulkdtqztphtvvfpsbl.supabase.co/auth/v1/callback`.
2. Supabase → *Authentication → Sign In / Providers → Google*: activarlo y pegar el Client ID y el Client Secret.
3. Supabase → *Authentication → URL Configuration*: **Site URL** = la URL de producción, y en **Redirect URLs** agregar `http://localhost:3000/auth/callback` y `https://<tu-dominio>/auth/callback`.
4. En Vercel, cargar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Datos demo y reset

La app arranca con **Madera Sur S.R.L.** (empresa ficticia) ya cargada: 8 proyectos activos o en cotización y 4 finalizados. Las fechas se generan relativas a “hoy”, para que las alertas de fecha y de inactividad tengan sentido cada vez que se abre la demo.

El proyecto principal es **P-1042 · Local Palermo – Mobiliario comercial** (Retail Sur): precio de venta $ 12.000.000, costo presupuestado $ 7.200.000, margen esperado 40%, proyectado ≈ 30,8% y salud *En riesgo* por materiales (+$ 850.000).

La primera vez que alguien entra, su empresa se carga con esta demo. Después:

- “Reset demo” (sidebar o `/settings`) vuelve a cargar la demo.
- `/settings` → “Vaciar datos” borra todo para empezar con proyectos reales.

Los datos se guardan en Supabase, por empresa. Solo el modo Gestión/Taller elegido queda en el navegador.

## Fórmulas

| Concepto | Fórmula |
|---|---|
| Total línea | `quantity × unitCost` (o monto directo si no aplica cantidad) |
| Costo presupuestado | `Σ budgetLines.total` (al aprobar se congela una copia: el **presupuesto base**) |
| Ganancia / rentabilidad esperada | `salesPrice − costo presupuestado` · `/ salesPrice × 100` (sin precio de venta → “—”, nunca un negativo) |
| Costo material real | `Σ (consumido + desperdicio) × unitCost` de **MaterialUsageEntry** |
| Costo no material | `Σ actualEntries.amount` (horas = `hours × hourlyCost`) |
| Costo real hasta hoy | material + no material |
| Desvío por categoría | `real − presupuestado`; `% = / presupuestado` (presupuestado 0 → sin %). Siempre las siete categorías de reporte: Materiales, Mano de obra, Diseño, Administración, Transporte y fletes, Gasto financiero, Imprevistos (Lote 4, ver `docs/DECISIONES_RUBROS.md`) |
| **Costo final proyectado** | `Σ_categoría max(presupuestado, real)` |
| Diferencia y “¿Por qué?” | `Σ_categoría (proyectado − presupuestado)`: el “¿Por qué?” lista cada categoría con desvío ≠ 0 y su total es exactamente la Diferencia |
| **Rentabilidad proyectada** | `(venta − costo final proyectado) / venta` |
| **Rentabilidad real final** | solo en `completed`: `(venta − costo real) / venta` |
| Delta de rentabilidad | `proyectada − esperada`, en **puntos de rentabilidad** |
| Márgenes agregados | ponderados por venta: `(Σventa − Σcosto) / Σventa` (no es un promedio simple) |

## Materiales: compra ≠ consumo ≠ desperdicio ≠ sobrante

- **PurchaseEntry**: registra qué se compró. **No suma al costo imputable.**
- **MaterialUsageEntry**: consumo, desperdicio y sobrante reutilizable, con su origen (`comprado para el proyecto`, `stock existente` o `sobrante reutilizado`).
- **Costo imputable** = consumo + desperdicio. El sobrante se valoriza y pasa al **pool**. Si otro proyecto lo usa, se descuenta del pool y el costo se imputa a ese proyecto.
- **Reconciliación**: lo comprado para el proyecto tiene que ser igual a consumido + desperdicio + sobrante. La diferencia “no explicada” se muestra y genera una alerta, pero **no bloquea** el cierre.
- **Valorización en taller**: el operario no carga precios. El sistema toma, en este orden, el valor del sobrante en el pool, la última compra del proyecto, el costo presupuestado o el costo de referencia del catálogo. **El origen del precio queda guardado en cada registro**, y gestión puede ver cómo se valorizó cada uno.

Ejemplo (spec §10, reproducido en P-1042): compradas 12 placas × $ 50.000 = $ 600.000, consumidas 9, desperdicio 1, sobrante 2. El **costo imputable es $ 500.000**.

## Rentabilidad proyectada (por qué no “rentabilidad real” a mitad de proyecto)

Si a mitad de camino se calcula `venta − costo registrado`, la rentabilidad sale artificialmente alta, porque falta ejecutar parte del presupuesto. Por eso, en cada categoría se asume que lo que queda del costo presupuestado se va a gastar, y cuando el real ya lo superó se toma el real (cálculo por reglas, no una predicción). El “margen real” solo existe cuando el proyecto está **finalizado**.

## Alertas (umbrales configurables en /settings)

| Alerta | Condición |
|---|---|
| Categoría | real > presupuestado: ≤10% info · 10–20% atención · >20% crítica |
| Rentabilidad | caída <5 puntos de rentabilidad info · 5–10 atención · >10 crítica |
| Sin registros | en Producción, 7 días sin consumos ni costos |
| Entrega | vencida (crítica) · ≤5 días para la entrega y todavía antes de Producción · mucho plazo transcurrido sin llegar a Producción |
| Reconciliación | lo comprado no coincide con lo explicado (info en Producción, atención en Instalación) |

**Salud del proyecto** (según sus alertas abiertas): *En riesgo* si hay al menos una alerta Crítica · *Atención* si hay alertas de Atención y ninguna Crítica · *Sin desvíos* si hay datos y no hay alertas · *Sin datos todavía* si no hay consumos ni costos. Los finalizados no llevan chip. La regla se muestra en Configuración.

El número del globo de alertas y la pestaña “Todas” salen de la misma cuenta (alertas abiertas). “Ver proyecto” no cambia nada; solo “Marcar resuelta” la oculta, y si el problema persiste (al día siguiente o con un nuevo registro en el proyecto) vuelve a aparecer.

## Verificación realizada

- `npm test`: 39 tests. Cubren márgenes, `salesPrice = 0`, presupuesto 0, real mayor y menor que el presupuesto, casos sin registros, compra mayor que el uso, uso desde stock, sobrante reutilizado, pool, cierre y los escenarios 1–10 sobre el seed real.
- `npm run lint` y `npm run build`: sin errores.
- Se recorrió en navegador (Playwright) la demo obligatoria completa: comprar 2 placas **no** cambia el margen, consumirlas **sí**, 10 h × $ 15.000 = $ 150.000, el registro mobile con 2 / 0,2 / 0,3 placas actualiza gestión, y se verificaron el cierre, el historial, el wizard y el reset. También se comprobó que no haya scroll horizontal a 390 px.

## Limitaciones (conscientes)

- “Gestión / Taller” sigue siendo un selector de modo: no hay roles con permisos distintos.
- Las escrituras son optimistas: si una falla, la pantalla muestra el aviso pero no deshace el cambio en memoria; al recargar se ve lo que quedó guardado.
- No es inventario: no hay depósitos, lotes, FIFO, stock mínimo ni transferencias. El pool de sobrantes es deliberadamente simple.
- No hay avance físico (%): se muestra el **plazo transcurrido**, que es tiempo y no trabajo hecho.
- El costo por hora del registro de taller sale de la tarifa presupuestada (o de un valor por defecto de $ 14.000).
- Los insights son reglas determinísticas: con pocos proyectos son indicios, no conclusiones.

## Futuras mejoras (a validar con usuarios antes de construir)

- Fotos o voz en el registro de taller, si las entrevistas muestran que reducen la fricción.
- Plantillas de presupuesto construidas a partir del historial (“proyectos tipo Local comercial usan +8% material”).
- Exportar el cierre a PDF o planilla.
- Métricas de uso de la herramienta (quién registra, cuándo, qué no se registra) como insumo de la investigación.
