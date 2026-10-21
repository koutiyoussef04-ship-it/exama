/**
 * Spanish copy of the "para organizaciones" pages (/es/para-organizaciones, /es/para-organizaciones/demo).
 * Same rules as en.ts: only what the workspace does; no clients, logos, testimonials, counts, statistics,
 * time savings or guarantees. Spain is the first market: "IVA", "oposiciones", "temas".
 */
import type { OrgCopy } from './types';

const n = (v: number) => new Intl.NumberFormat('es-ES', { useGrouping: 'always' }).format(v);

export const esOrg: OrgCopy = {
  meta: {
    title: 'Exama para organizaciones — Bancos de preguntas a partir de tu propio material',
    description:
      'Para academias y centros de formación: sube tu material, recibe borradores de preguntas redactados por IA con su fuente, revísalos y apruébalos en equipo y expórtalos a Moodle o CSV. Piloto gratuito de 30 días.',
    demoTitle: 'Solicitar una demo — Exama para organizaciones',
    demoDescription: 'Pide por correo una demostración del espacio de trabajo para organizaciones de Exama, o empieza tú mismo el piloto gratuito de 30 días.',
  },
  nav: { how: 'Cómo funciona', pricing: 'Precios', faq: 'Preguntas', students: 'Para estudiantes', demo: 'Demo' },
  cta: { pilot: (days) => `Empieza el piloto gratuito de ${days} días`, pilotShort: 'Empezar el piloto gratuito', demo: 'Solicitar una demo', seeHow: 'Ver cómo funciona' },
  hero: {
    eyebrow: 'Para academias y centros de formación',
    titleStart: 'Bancos de preguntas redactados a partir de ',
    titleHighlight: 'tu propio material.',
    lead: 'Sube un curso en PDF o PowerPoint. Exama redacta preguntas y muestra el pasaje del que sale cada una. Tu equipo las revisa, edita y aprueba —nada se publica sin un revisor— y exporta las aprobadas a Moodle o CSV.',
    note: (days) => `${days} días gratis. Sin tarjeta y sin cargos automáticos. Tus cursos y preguntas siguen siendo tuyos.`,
    chipsAria: 'Qué hace el espacio de trabajo',
    chips: ['Cursos en PDF y PowerPoint', 'Una fuente para cada pregunta', 'Revisión antes de usar nada', 'Exportación a Moodle GIFT o CSV'],
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
    title: 'Dos tipos de organización, un mismo espacio de trabajo',
    lead: 'Al crear la organización eliges su tipo. Define el formato de las preguntas y los campos que ven tus revisores; nada más cambia.',
    items: [
      {
        title: 'Academias de oposiciones',
        text: 'Para la preparación de oposiciones, donde cada pregunta debe señalar el texto que evalúa.',
        icon: 'exam',
        points: ['Preguntas tipo test con cuatro opciones', 'Campos para la referencia legal (norma, artículo)', 'Preguntas organizadas por tema dentro de cada curso'],
      },
      {
        title: 'Centros y empresas de formación',
        text: 'Para formación en la empresa y cursos profesionales construidos a partir de tus propios módulos.',
        icon: 'folder',
        points: ['Preguntas tipo test y de respuesta corta', 'Preguntas organizadas por módulo y tema', 'Exportaciones que entran directamente en Moodle o en tus herramientas'],
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
    title: 'Empieza con un piloto gratuito. Elige un plan cuando encaje.',
    lead: 'Exama activa el plan para tu organización después de que lo solicites. No hay pago en línea y no se cobra nada automáticamente.',
    perMonth: '/mes',
    plusVat: '+ IVA',
    orYearly: (yearly, pct) => `o ${yearly}/año + IVA (ahorra un ${pct} %)`,
    pilotPrice: 'Gratis',
    pilotDuration: (days) => `durante ${days} días`,
    custom: 'A medida',
    customSub: 'precio y límites',
    plans: {
      pilot: {
        name: 'Piloto',
        tagline: 'Prueba todo el espacio de trabajo con tu propio material.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} cursos`, `${n(l!.itemsPerMonth)} borradores de preguntas en total`, `${n(l!.maxMembers)} administradores o editores`, 'Revisores ilimitados', `Hasta ${n(perRequest)} borradores por petición`, 'Exportación Moodle GIFT y CSV'],
        cta: 'Empezar el piloto gratuito',
      },
      esencial: {
        name: 'Esencial',
        tagline: 'Para una academia o un departamento.',
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
    billingNote: 'El piloto no necesita tarjeta. Los planes de pago se acuerdan por correo y los activa Exama; nunca se te cobra sin haber solicitado un plan.',
  },
  pilot: {
    eyebrow: 'El piloto',
    title: (days) => `${days} días para probarlo con tus propios cursos`,
    lead: 'El piloto empieza en el momento en que se crea la cuenta de la organización. Es el espacio de trabajo completo, con estos límites para todo el piloto:',
    includes: (l, perRequest) => [`${n(l.coursesPerMonth)} cursos`, `${n(l.itemsPerMonth)} borradores de preguntas en total`, `${n(l.maxMembers)} administradores o editores, revisores ilimitados`, `Hasta ${n(perRequest)} borradores por petición`],
    afterTitle: 'Cuando termina el piloto',
    after: [
      'No se cobra nada y no se borra nada.',
      'Tu equipo puede seguir leyendo, revisando y exportando todos los cursos y preguntas.',
      'Los cursos nuevos y los borradores nuevos esperan hasta que se active un plan para la organización.',
    ],
  },
  faq: {
    eyebrow: 'Preguntas frecuentes',
    title: 'Lo que preguntan las organizaciones',
    items: (days) => [
      {
        q: '¿Qué podemos subir?',
        a: ['Archivos PDF y PowerPoint (.pptx) que contengan texto real. Las imágenes escaneadas sin capa de texto no se pueden leer. Cada curso es un archivo; puedes subir tantos cursos como permita tu plan.'],
      },
      {
        q: '¿Qué cuenta como un borrador de pregunta?',
        a: [
          'Un borrador es una pregunta que Exama redacta y guarda para tu revisión. Pides un número de borradores (hasta 20 por petición) y solo cuentan los que se entregan. Las preguntas que tus editores añaden a mano no cuentan.',
          `En el piloto el límite es un total para los ${days} días; en Esencial y Profesional es por mes natural.`,
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
        q: '¿Qué pasa después del piloto?',
        a: [`Pasados los ${days} días, no se cobra nada y no se borra nada. Tu equipo puede seguir leyendo, revisando y exportándolo todo. Para subir cursos nuevos o redactar preguntas nuevas, solicita un plan y lo activamos para tu organización.`],
      },
      {
        q: '¿Cómo se paga un plan?',
        a: ['Solicita Esencial, Profesional o Centro por correo. Acordamos contigo el plan y el periodo de facturación y lo activamos; los precios no incluyen IVA. No hay pago en línea y no se cobra nada automáticamente: ni al acabar el piloto ni en la renovación.'],
      },
    ],
  },
  final: {
    title: 'Pruébalo con uno de tus cursos.',
    text: 'Crea la cuenta de la organización, sube un curso y revisa los primeros borradores con tu equipo.',
    note: 'Gratis durante 30 días. Sin tarjeta. Tu material sigue siendo tuyo.',
  },
  demo: {
    title: 'Solicitar una demo',
    intro: 'Cuéntanos cómo es tu organización y te responderemos por correo para concertar una demostración del espacio de trabajo, resolver tus dudas o preparar un plan.',
    includeTitle: 'Nos ayuda saber',
    include: ['Tu organización y qué enseña (oposiciones, formación en la empresa, cursos profesionales…)', 'Con cuántos cursos o módulos empezaríais, y en qué formato', 'Cuántas personas subirían material, redactarían y revisarían preguntas', 'Qué plan estáis valorando, o qué necesitaríais de Centro'],
    emailButton: 'Escribir a examaweb@gmail.com',
    emailHow: 'El botón abre tu aplicación de correo con un mensaje preparado. Si no se abre, escribe a la dirección de abajo.',
    addressLead: 'Nuestra dirección para organizaciones:',
    subject: 'Exama para organizaciones — solicitud de demo',
    body: 'Hola, Exama:\n\nNos gustaría ver una demo del espacio de trabajo para organizaciones.\n\nOrganización:\nQué enseñamos:\nCursos o módulos para empezar:\nPersonas que revisarían preguntas:\nPlan que estamos valorando:\n\nGracias,\n',
    replyNote: 'Respondemos por correo. Pedir una demo no crea ninguna cuenta ni genera ningún cargo.',
    orTitle: '¿Prefieres probarlo por tu cuenta?',
    orText: (days) => `El piloto de ${days} días es gratuito y empieza en cuanto se crea la cuenta de la organización; no hace falta demo.`,
    back: '← Volver a Exama para organizaciones',
  },
  footer: { heading: 'Organizaciones', overview: 'Para organizaciones', pricing: 'Planes para organizaciones', demo: 'Solicitar una demo' },
};
