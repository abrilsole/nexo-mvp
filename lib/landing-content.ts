/**
 * Textos del landing. Todo sale de PRODUCT_CONTEXT.md: no hay testimonios, logos de clientes
 * ni precios inventados, porque el producto todavía está validando Problem–Solution Fit.
 */
import { APP_NAME } from "@/lib/constants";

/** Reemplazar por el mail o formulario real del equipo antes de publicar. */
export const PILOT_CONTACT_HREF = `mailto:equipo@blerp.example?subject=${encodeURIComponent(`Quiero sumarme al piloto de ${APP_NAME}`)}`;

export const DEMO_HREF = "/dashboard";

/** Login con Google; después vuelve al dashboard. */
export const LOGIN_HREF = "/login";

export const NAV_LINKS = [
  { href: "#producto", label: "Producto" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#taller", label: "Modo Taller" },
  { href: "#piloto", label: "Piloto" },
  { href: "#preguntas", label: "Preguntas" },
];

export const SEGMENTS = [
  "Muebles a medida",
  "Mobiliario comercial",
  "Mobiliario corporativo",
  "Equipamiento para locales",
  "Exhibidores",
  "Stands",
  "Carpintería a medida",
];

export const PROBLEM_POINTS = [
  {
    title: "Planillas que nadie actualiza",
    body: "La cotización vive en un Excel y la ejecución en otro, si es que se carga. Consolidar lleva horas y llega tarde.",
  },
  {
    title: "Datos en WhatsApp y facturas",
    body: "Lo que se usó, lo que se rompió y lo que se compró de más queda disperso en chats, remitos y papeles.",
  },
  {
    title: "La memoria del jefe de planta",
    body: "El stock y los sobrantes dependen de quién se acuerda. Cuando falta esa persona, falta el dato.",
  },
];

export const FEATURES = [
  {
    key: "margin",
    title: "Rentabilidad proyectada, no solo el final",
    body: "En cada categoría asumimos que lo que queda del costo presupuestado se va a gastar. Así ves cómo viene la rentabilidad a mitad de obra, sin números inflados.",
  },
  {
    key: "workshop",
    title: "Registro de taller en menos de 30 segundos",
    body: "Desde el celular, el operario elige el proyecto, el material y las cantidades. Sin precios ni costos en pantalla.",
  },
  {
    key: "purchase",
    title: "Compra ≠ consumo",
    body: "Comprar 12 placas no cambia la rentabilidad. Consumirlas, desperdiciarlas o dejarlas como sobrante, sí.",
  },
  {
    key: "alerts",
    title: "Alertas que dirigen la atención",
    body: "Desvíos por categoría, caída de rentabilidad, proyectos sin registros y entregas en riesgo. Umbrales configurables.",
  },
  {
    key: "leftovers",
    title: "Sobrantes reutilizables",
    body: "Lo que sobra se valoriza y pasa a un pool. Si otro proyecto lo usa, el costo se imputa ahí.",
  },
  {
    key: "history",
    title: "Cierre e historial",
    body: "Al cerrar un proyecto podés reconstruir qué pasó y llevar ese aprendizaje a la próxima cotización.",
  },
] as const;

export const STEPS = [
  {
    title: "Cargás el costo presupuestado",
    body: `Por rubros (carpintería, vidrios, pintura, herrajes…): materiales, horas de mano de obra y horas administrativas. Con el precio de venta, ${APP_NAME} calcula la rentabilidad esperada.`,
  },
  {
    title: "El taller registra lo que pasó",
    body: "Desde el celular, en el proyecto asignado: “usé 2 placas, 0,2 fueron desperdicio, quedó 0,3 reutilizable”.",
  },
  {
    title: `${APP_NAME} lo traduce a costo`,
    body: "Valoriza con reglas explícitas (el costo del lote del que sale el material) y guarda de dónde salió el precio.",
  },
  {
    title: "Gestión ve la rentabilidad y decide",
    body: "Costo real hasta hoy, rentabilidad proyectada, desvíos, alertas y actividad: quién, qué y cuándo.",
  },
];

export const WORKSHOP_POINTS = [
  "Pensado para el celular del taller",
  "Elegís material, origen y cantidades",
  "Consumo, desperdicio y sobrante por separado",
  "No muestra precios ni costos",
];

export const MANAGEMENT_POINTS = [
  "KPIs y proyectos que necesitan atención",
  "Costo presupuestado vs. real por categoría",
  "Reconciliación de lo comprado vs. lo explicado",
  "Actividad de cada proyecto",
];

/** Ejemplo de PRODUCT_CONTEXT.md (spec §10), reproducido en la demo con P-1042. */
export const EXAMPLE_STATS = [
  { value: "12", label: "placas compradas", detail: "$ 600.000" },
  { value: "9", label: "consumidas", detail: "$ 450.000" },
  { value: "1", label: "desperdicio", detail: "$ 50.000" },
  { value: "2", label: "sobrantes reutilizables", detail: "pasan al pool" },
];

/** Lo que observamos en las entrevistas: son observaciones, no citas atribuidas. */
export const FINDINGS = [
  "Compras hechas específicamente para un proyecto.",
  "Materiales repartidos en distintos sectores de la planta.",
  "Un conocimiento del stock que depende de la memoria de las personas.",
  "Sobrantes reutilizables que no siempre quedan registrados.",
  "Compras imputadas completas a un proyecto aunque parte del material quedara disponible.",
  "Consolidaciones manuales hechas después para entender los costos.",
];

export const PILOT_GIVES = [
  `Acceso a ${APP_NAME} durante la validación`,
  "Acompañamiento para cargar tus primeros proyectos",
  "Registro de taller desde el celular de cada operario",
  "Los resultados de la investigación cuando termine",
];

export const PILOT_ASKS = [
  "Una PyME que fabrique por proyecto",
  "Varios proyectos en curso, cada uno con su cotización",
  "Una entrevista inicial y una de cierre",
  "Feedback honesto: qué sirve, qué sobra y qué falta",
];

export const FAQS = [
  {
    q: `¿${APP_NAME} es un ERP?`,
    a: "No. Contabilidad, facturación, payroll, CRM, órdenes de compra complejas, múltiples depósitos o planificación de producción quedan afuera a propósito. El stock aparece solo porque ayuda a explicar el costo real y la rentabilidad.",
  },
  {
    q: "¿Qué es la rentabilidad proyectada?",
    a: "Si a mitad de proyecto calculás venta menos costo registrado, la rentabilidad sale artificialmente alta. Por eso, en cada categoría asumimos que lo que queda del costo presupuestado se va a gastar y, cuando lo real ya lo superó, tomamos lo real. La rentabilidad real final existe recién cuando el proyecto termina.",
  },
  {
    q: "¿Quién registra en el taller?",
    a: "Es una de las preguntas que queremos responder con el piloto. El registro está pensado para que cualquier operario lo haga en menos de 30 segundos desde el celular, sin ver precios ni costos.",
  },
  {
    q: "¿Tengo que dejar mi Excel?",
    a: "No hace falta para probarlo. Queremos entender si cambiarías tu planilla por una herramienta así, y qué le falta para que valga la pena.",
  },
  {
    q: "¿Cuánto cuesta?",
    a: `${APP_NAME} es parte de una tesis de la Licenciatura en Gestión de Negocios y Tecnología del ITBA. Todavía no investigamos la disposición a pagar: primero queremos validar que el problema y la solución tienen sentido.`,
  },
  {
    q: "¿Los números de la demo son reales?",
    a: "No. La demo usa una empresa ficticia, Madera Sur S.R.L., y sus números no provienen de ninguna empresa entrevistada. Cuando quieras, desde Configuración podés vaciar los datos y cargar tus proyectos reales.",
  },
];
