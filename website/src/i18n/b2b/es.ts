/**
 * Spanish copy of the "para organizaciones" pages (/es/para-organizaciones, /es/para-organizaciones/demo).
 * Same rules as en.ts: only what the workspace does; no clients, logos, testimonials, counts, statistics,
 * time savings or guarantees. Spanish-market terms: "IVA", "temas".
 */
import type { OrgCopy } from './types';

const n = (v: number) => new Intl.NumberFormat('es-ES', { useGrouping: 'always' }).format(v);

export const esOrg: OrgCopy = {
  meta: {
    title: 'Exama para organizaciones — Preguntas tipo test a partir de tu temario',
    description:
      'Para universidades, centros educativos, centros de formación y empresas: sube tu material, recibe borradores de preguntas redactados por IA con su fuente, revísalos y apruébalos en equipo y expórtalos a Moodle o CSV. Planes mensuales o anuales, activados por Exama.',
    demoTitle: 'Solicitar una demo — Exama para organizaciones',
    ogAlt: 'Exama para organizaciones: preguntas tipo test a partir de tu temario, cada una con su fuente',
    demoDescription: 'Pide por correo una demostración del espacio de trabajo para organizaciones de Exama o cuéntanos qué plan encaja con tu organización.',
  },
  nav: { how: 'Cómo funciona', pricing: 'Precios', faq: 'Preguntas', students: 'Para estudiantes', demo: 'Demo' },
  cta: { demo: 'Solicitar una demo', seePricing: 'Ver planes y precios', seeHow: 'Ver cómo funciona', createAccount: 'Crear una cuenta de organización' },
  hero: {
    eyebrow: 'Para universidades, centros educativos, centros de formación y empresas',
    titleStart: 'Convierte tu temario en preguntas tipo test, ',
    titleHighlight: 'cada una con su fuente.',
    lead: 'Sube un PDF o un PowerPoint. Exama redacta las preguntas y muestra el pasaje del que sale cada una. Tu equipo revisa y aprueba cada pregunta antes de usarla y después las exporta a Moodle o CSV.',
    note: 'Planes mensuales o anuales · Precios sin IVA · Sin cargos automáticos',
    trustAria: 'Cómo se trata tu material',
    trust: ['Datos en la UE (Fráncfort)', 'Solo tu organización ve su material', 'Nada se aprueba sin un revisor', 'Exporta cuando quieras: Moodle GIFT o CSV'],
    shotAlt: 'La pantalla de revisión de Exama: el pasaje del curso junto a la pregunta redactada, con los controles de aprobar y rechazar',
    flowAria: 'Del material del curso a un banco de preguntas revisado: entra el material, salen borradores con su fuente, los revisa tu equipo y se exportan',
    flowIn: 'Tu material',
    inputs: ['PDF del curso', 'Diapositivas PowerPoint'],
    flowCore: 'Borradores con su fuente',
    flowCoreSub: 'Cada pregunta cita el pasaje en el que se basa',
    flowOut: 'Tras tu revisión',
    outputs: ['Banco de preguntas aprobadas', 'Exportación Moodle GIFT', 'Exportación CSV'],
  },
  audiences: {
    eyebrow: 'Para quién es',
    title: 'Todo tipo de organización, un mismo espacio de trabajo',
    lead: 'Al crear la organización indicas de qué tipo es: universidad o educación superior, centro educativo, centro de formación, empresa, clases particulares o preparación de exámenes. El espacio de trabajo es el mismo para todas.',
    items: [
      {
        title: 'Universidades y centros educativos',
        text: 'Para asignaturas impartidas a partir de tu propio programa, donde el profesorado controla cada pregunta.',
        icon: 'building',
        points: ['Preguntas tipo test y de respuesta corta', 'Preguntas organizadas por módulo y tema dentro de cada curso', 'Cada pregunta muestra el fragmento en el que se basa'],
      },
      {
        title: 'Centros de formación y empresas',
        text: 'Para cursos profesionales y formación de empleados construidos a partir de tus propios módulos.',
        icon: 'folder',
        points: ['Borradores a partir de PDF y diapositivas de PowerPoint', 'Revisados y aprobados por tu equipo antes de usarse', 'Exportaciones que entran directamente en Moodle o en tus herramientas'],
      },
      {
        title: 'Clases particulares y preparación de exámenes',
        text: 'Para centros que preparan a estudiantes para un examen, donde la práctica debe ceñirse al material.',
        icon: 'target',
        points: ['Preguntas que no salen del material subido', 'Aprueba, rechaza o edita cada borrador', 'Revisores sin coste, en todos los planes'],
      },
    ],
  },
  how: {
    eyebrow: 'Cómo funciona',
    title: 'De un archivo del curso a un banco de preguntas aprobadas',
    lead: 'Cuatro pasos, todos dentro del espacio de trabajo para organizaciones en app.exama.app.',
    steps: [
      { title: 'Sube un curso', text: 'Un PDF o PowerPoint (.pptx) con texto real. Exama lo lee, lo divide en páginas o diapositivas y detecta sus temas.', icon: 'upload' },
      { title: 'Redacta preguntas', text: 'Pide hasta 20 borradores de una vez, para todo el curso o para un tema. Cada borrador llega con el pasaje citado, su página o diapositiva y comprobaciones automáticas.', icon: 'sparkle' },
      { title: 'Revisad en equipo', text: 'La cola de revisión muestra la fuente junto a la pregunta. Los revisores editan, aprueban o rechazan, una a una, con atajos de teclado en el ordenador.', icon: 'graded' },
      { title: 'Exporta lo aprobado', text: 'Solo las preguntas aprobadas salen del espacio de trabajo: Moodle GIFT o CSV, de un curso, de un tema o de todo.', icon: 'export' },
    ],
  },
  review: {
    eyebrow: 'Con fuente y con revisión',
    title: 'Cada pregunta muestra de dónde sale',
    lead: 'Los borradores se redactan solo a partir de tu material, no de lo que un modelo recuerda sobre la materia. Después decide tu equipo.',
    points: [
      'El pasaje citado se localiza en tu curso, con su página o diapositiva, y se resalta junto a la pregunta.',
      'Las comprobaciones automáticas marcan los borradores cuya cita no se encuentra o solo coincide de forma aproximada, las respuestas con cifras que no están en el pasaje y los distractores débiles en las preguntas tipo test.',
      'Una segunda comprobación lee el pasaje localizado e indica si respalda la respuesta; es orientativa y se muestra al revisor.',
      'Nada se aprueba automáticamente. Un revisor aprueba cada pregunta que entra en el banco.',
    ],
    screens: [
      { id: 'org-review', title: 'Revisión en paralelo', text: 'El pasaje fuente a la izquierda y la pregunta editable a la derecha. Aprobar, rechazar o aprobar y pasar a la siguiente.', icon: 'quote', alt: 'La pantalla de revisión de Exama: el pasaje fuente citado junto a la pregunta editable, con los controles de aprobar y rechazar' },
      { id: 'org-queue', title: 'Cola de revisión', text: 'Los borradores en una tabla con buscador, filtrados por curso y tema, con los que requieren atención primero.', icon: 'search', alt: 'La cola de revisión de Exama: una tabla de borradores de preguntas con buscador y filtros por curso y tema' },
      { id: 'org-dashboard', title: 'Panel y uso', text: 'Cursos, borradores por revisar, preguntas aprobadas y miembros de un vistazo, y cuánto del plan se ha usado.', icon: 'chart', alt: 'El panel de la organización en Exama con el número de cursos, borradores, preguntas aprobadas y miembros, y el uso respecto al plan' },
    ],
  },
  team: {
    eyebrow: 'Tu equipo',
    title: 'Roles pensados para cómo se hace un banco de preguntas',
    lead: 'Cada miembro entra con su propia cuenta, así que cada aprobación lleva un nombre.',
    roles: [
      { name: 'Administrador', text: 'Añade y elimina miembros, cambia roles y ajustes, y hace todo lo que hace un editor.' },
      { name: 'Editor', text: 'Sube cursos, redacta preguntas, añade preguntas a mano, exporta y elimina.' },
      { name: 'Revisor', text: 'Lee, edita, aprueba y rechaza preguntas. Nada más.' },
    ],
    reviewersNote: 'Los planes cuentan administradores y editores. Los revisores son ilimitados en todos los planes.',
    usageTitle: 'Un uso que se ve',
    usageText: 'El panel muestra los cursos subidos y los borradores de preguntas generados respecto a tu plan. El espacio de trabajo se detiene en el límite; nunca cobra de más.',
  },
  pricing: {
    eyebrow: 'Precios',
    title: 'Planes para tu organización',
    lead: 'Elige el plan que encaje con tu volumen. Exama lo activa para tu organización una vez acordado contigo. No hay pago en línea y no se cobra nada automáticamente.',
    perMonth: '/mes',
    plusVat: '+ IVA',
    orYearly: (yearly, pct) => `o ${yearly}/año + IVA (ahorra un ${pct} %)`,
    custom: 'A medida',
    customSub: 'precio y límites',
    plans: {
      esencial: {
        name: 'Esencial',
        tagline: 'Para un centro o un departamento.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} cursos subidos al mes`, `${n(l!.itemsPerMonth)} borradores de preguntas al mes`, `${n(l!.maxMembers)} administradores o editores`, 'Revisores ilimitados', `Hasta ${n(perRequest)} borradores por petición`, 'Exportación Moodle GIFT y CSV'],
        cta: 'Solicitar Esencial',
      },
      profesional: {
        name: 'Profesional',
        tagline: 'Para varios cursos en marcha a la vez.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} cursos subidos al mes`, `${n(l!.itemsPerMonth)} borradores de preguntas al mes`, `${n(l!.maxMembers)} administradores o editores`, 'Revisores ilimitados', `Hasta ${n(perRequest)} borradores por petición`, 'Exportación Moodle GIFT y CSV'],
        cta: 'Solicitar Profesional',
      },
      centro: {
        name: 'Centro',
        tagline: 'Para centros con sus propios volúmenes.',
        features: () => ['Límites de cursos y borradores acordados contigo', 'Plazas de administrador y editor acordadas contigo', 'Revisores ilimitados', 'Exportación Moodle GIFT y CSV'],
        cta: 'Hablar con nosotros',
      },
    },
    vatNote: 'Precios sin IVA. El IVA se añade al tipo aplicable cuando se factura el plan.',
    billingNote: 'Los planes se acuerdan por correo y los activa Exama; nunca se te cobra sin haber solicitado un plan.',
    pilotNote: {
      title: '¿Quieres verlo antes con tu propio material?',
      text: 'Pídenos una demo. Para algunos proyectos podemos acordar con la organización un piloto durante un periodo limitado; estudiamos cada solicitud de forma individual.',
      cta: 'Contactar con nosotros',
    },
  },
  start: {
    eyebrow: 'Cómo empezar',
    title: 'De una primera conversación a tu espacio de trabajo',
    lead: 'Exama activa los planes, así que para empezar basta con una breve conversación con nosotros.',
    steps: [
      { title: 'Cuéntanos sobre tu organización', text: 'Solicita una demo o escríbenos: qué enseñáis y cuántos cursos y personas participarían.', icon: 'mail' },
      { title: 'Acordamos un plan', text: 'Esencial, Profesional o Centro, mensual o anual. Confirmamos el plan y sus condiciones por correo.', icon: 'check' },
      { title: 'Crea la cuenta de la organización', text: 'Tu nombre, tu correo y el nombre y el tipo de la organización. Confirma tu correo con el enlace que te enviamos.', icon: 'users' },
      { title: 'Activamos tu plan', text: 'Una vez activo, tu equipo puede subir cursos, redactar preguntas y añadir compañeros como editores o revisores.', icon: 'upload' },
    ],
    noPlanTitle: 'Antes de que haya un plan activo',
    noPlan: ['La cuenta y el espacio de trabajo se pueden crear en cualquier momento.', 'Subir cursos y redactar preguntas es posible en cuanto Exama active un plan.', 'No se cobra nada: un plan solo se activa después de que lo solicites.'],
  },
  faq: {
    eyebrow: 'Preguntas frecuentes',
    title: 'Lo que preguntan las organizaciones',
    items: [
      {
        q: '¿Qué podemos subir?',
        a: ['Archivos PDF y PowerPoint (.pptx) que contengan texto real. Las imágenes escaneadas sin capa de texto no se pueden leer. Cada curso es un archivo; puedes subir tantos cursos como permita tu plan.'],
      },
      {
        q: '¿Qué cuenta como un borrador de pregunta?',
        a: [
          'Un borrador es una pregunta que Exama redacta y guarda para tu revisión. Pides un número de borradores (hasta 20 por petición) y solo cuentan los que se entregan. Las preguntas que tus editores añaden a mano no cuentan.',
          'En Esencial y Profesional el límite es por mes natural.',
        ],
      },
      {
        q: '¿Las preguntas se basan en nuestro material?',
        a: [
          'Sí. Los borradores se redactan solo a partir del texto del curso que subiste, y cada uno cita el pasaje en el que se basa, con su página o diapositiva. Los borradores cuya cita no se encuentra en el material se marcan para el revisor.',
          'Sigue siendo un borrador: un revisor lo lee, lo edita si hace falta y lo aprueba antes de que entre en el banco.',
        ],
      },
      {
        q: '¿Podemos editar las preguntas o escribir las nuestras?',
        a: ['Sí. Los revisores pueden editar cualquier borrador antes de aprobarlo. Los editores pueden añadir preguntas a mano; pasan por la misma cola de revisión que las redactadas.'],
      },
      {
        q: '¿Cómo llevamos las preguntas a Moodle?',
        a: ['Exporta las preguntas aprobadas como archivo Moodle GIFT e impórtalo en un banco de preguntas de Moodle. También hay exportación CSV para otras herramientas. Las exportaciones incluyen solo preguntas aprobadas, de un curso, de un tema o de todo.'],
      },
      {
        q: '¿Dónde se guarda nuestro material y quién lo ve?',
        a: [
          'Los cursos, las preguntas y las cuentas se guardan en servidores de la Unión Europea (Fráncfort). Solo los miembros de tu organización ven su material. Para redactar y comprobar preguntas, los pasajes relevantes se envían a un proveedor externo de IA (Anthropic); Exama usa tu material solo para redactar y comprobar preguntas para tu organización.',
          'Las condiciones específicas para organizaciones y el acuerdo de tratamiento de datos se están terminando; pregúntanos al solicitar un plan.',
        ],
      },
      {
        q: '¿Podemos probar Exama antes de elegir un plan?',
        a: ['Sí: pídenos una demo y te mostraremos el espacio de trabajo con material de curso real. Para algunos proyectos también acordamos un piloto con la organización, durante un periodo limitado y con unos límites fijados. Los pilotos se acuerdan caso por caso; no están disponibles por defecto.'],
      },
      {
        q: '¿Cómo se paga un plan?',
        a: ['Solicita Esencial, Profesional o Centro por correo. Acordamos contigo el plan y el periodo de facturación y lo activamos; los precios no incluyen IVA. No hay pago en línea y no se cobra nada automáticamente: ni al empezar ni en la renovación.'],
      },
    ],
  },
  final: {
    title: 'Míralo con uno de tus cursos.',
    text: 'Solicita una demo o cuéntanos qué plan encaja con tu organización.',
    note: 'Exama activa los planes. Sin cargos automáticos. Tu material sigue siendo tuyo.',
  },
  demo: {
    title: 'Solicitar una demo',
    intro: 'Cuéntanos cómo es tu organización y te responderemos por correo para concertar una demostración del espacio de trabajo, resolver tus dudas o preparar un plan.',
    includeTitle: 'Nos ayuda saber',
    include: ['Tu organización y qué enseña (cursos universitarios o escolares, formación profesional, formación de empleados, preparación de exámenes…)', 'Con cuántos cursos o módulos empezaríais, y en qué formato', 'Cuántas personas subirían material, redactarían y revisarían preguntas', 'Qué plan estáis valorando, o qué necesitaríais de Centro'],
    emailButton: 'Escribir a examaweb@gmail.com',
    emailHow: 'El botón abre tu aplicación de correo con un mensaje preparado. Si no se abre, escribe a la dirección de abajo.',
    addressLead: 'Nuestra dirección para organizaciones:',
    subject: 'Exama para organizaciones — solicitud de demo',
    body: 'Hola, Exama:\n\nNos gustaría ver una demo del espacio de trabajo para organizaciones.\n\nOrganización:\nQué enseñamos:\nCursos o módulos para empezar:\nPersonas que revisarían preguntas:\nPlan que estamos valorando:\n\nGracias,\n',
    replyNote: 'Respondemos por correo. Pedir una demo no crea ninguna cuenta ni genera ningún cargo.',
    orTitle: '¿Ya hemos acordado un plan?',
    orText: 'Crea la cuenta de la organización y dinos su nombre: activaremos el plan acordado.',
    back: '← Volver a Exama para organizaciones',
  },
  footer: {
    tagline: 'Preguntas tipo test a partir de tu propio material, cada una con su fuente y revisada por tu equipo.',
    product: 'Para organizaciones',
    account: 'Cuenta',
    how: 'Cómo funciona',
    pricing: 'Precios',
    faq: 'Preguntas frecuentes',
    demo: 'Solicitar una demo',
    signup: 'Crear una cuenta de organización',
    students: 'Exama para estudiantes',
  },
};
