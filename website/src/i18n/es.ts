import type { Copy } from './types';

/** Español. Mismos hechos que la versión inglesa (src/i18n/en.ts). */
export const es: Copy = {
  meta: {
    title: 'Exama — Tu entrenador de exámenes con IA',
    description: 'Convierte el material de tu curso en exámenes personalizados, corrección, práctica de temas débiles y un plan de estudio.',
    ogAlt: 'Exama: convierte el material de tu curso en tu entrenador personal de exámenes con IA.',
  },
  ui: { skip: 'Saltar al contenido', menu: 'Menú', homeAria: 'Exama — inicio', language: 'Idioma', primaryNav: 'Principal', mobileNav: 'Móvil' },
  nav: {
    how: 'Cómo funciona',
    materials: 'Materiales',
    pricing: 'Precios',
    faq: 'Preguntas',
    login: 'Iniciar sesión',
    loginStudent: 'Entrar como estudiante',
    loginOrganization: 'Entrar como organización',
    loginAria: 'Iniciar sesión: elige el tipo de cuenta',
    students: 'Para estudiantes',
    organizations: 'Para organizaciones',
  },
  cta: {
    trial: (days) => `Empieza tu prueba gratuita de ${days} días`,
    free: 'Empieza gratis',
    secondary: 'Cómo funciona',
    choose: (plan) => `Elegir ${plan}`,
    startFree: 'Empezar gratis',
  },
  choice: {
    aria: 'Para quién es Exama',
    students: { title: 'Para estudiantes', text: 'Sube el material de tu curso y recibe exámenes personalizados, corrección, práctica de temas débiles y un plan de estudio.', cta: 'Exama para estudiantes' },
    organizations: { title: 'Para organizaciones', text: 'Universidades, centros educativos, centros de formación y empresas: bancos de preguntas redactados a partir de tu propio material y revisados por tu equipo.', cta: 'Exama para organizaciones' },
  },
  students: {
    meta: {
      title: 'Exama para estudiantes: exámenes personalizados a partir de tu propio material',
      description: 'Sube tu PDF, PowerPoint, audio o vídeo. Exama redacta exámenes de práctica a partir de él, corrige tus respuestas, detecta tus temas débiles y planifica tu estudio.',
      ogAlt: 'Exama para estudiantes: convierte el material de tu curso en tu entrenador personal de exámenes con IA.',
    },
    eyebrow: 'Para estudiantes',
    titleStart: 'Exámenes de práctica redactados a partir de ',
    titleHighlight: 'tu propio material.',
    lead: 'Sube lo que compone tu curso. Exama lo convierte en exámenes personalizados, corrige cada respuesta con el fragmento del que procede, detecta los temas que se te escapan y mantiene tu práctica en marcha.',
    signIn: 'Entrar como estudiante',
    orgNote: '¿Enseñas en una universidad, un centro educativo, un centro de formación o una empresa?',
    orgLink: 'Descubre Exama para organizaciones',
  },
  hero: {
    eyebrow: 'Preparación de exámenes con IA para estudiantes',
    titleStart: 'Convierte el material de tu curso en tu ',
    titleHighlight: 'entrenador personal de exámenes con IA.',
    lead: 'Sube tu PDF, PowerPoint, audio o vídeo. Exama convierte el material de tu curso en exámenes personalizados, corrección, práctica de temas débiles y un plan de estudio.',
    noteTrial: (days) => `${days} días gratis · Se pide una tarjeta, sin pago hoy · Cancela cuando quieras antes de que termine`,
    noteFree: 'Plan gratuito · Sin tarjeta',
    formatsAria: 'Material compatible',
    formats: { pdf: 'PDF', slides: 'PowerPoint', audio: 'Audio', video: 'Vídeo' },
    outputs: ['Exámenes personalizados', 'Corrección y comentarios', 'Práctica de temas débiles', 'Plan de estudio'],
    flowAria: 'Diagrama: tu PDF, PowerPoint, audio y vídeo entran en Exama, que los convierte en exámenes personalizados, corrección, práctica de temas débiles y un plan de estudio.',
    flowIn: 'El material de tu curso',
    flowCore: 'Exama lo entiende',
    flowCoreSub: 'Temas, ideas clave y definiciones de tu propio material',
    flowOut: 'Lo que obtienes',
  },
  how: {
    eyebrow: 'Cómo funciona',
    title: 'Del material del curso a estar listo para el examen, en seis pasos',
    steps: [
      { title: 'Sube tu material', text: 'Añade un PDF, PowerPoint, audio o vídeo de tu curso.', icon: 'upload' },
      { title: 'Exama entiende tu material', text: 'Lo lee o lo transcribe todo y identifica los temas que cubre tu curso.', icon: 'sparkle' },
      { title: 'Haz un examen personalizado', text: 'Recibe preguntas tipo test y de respuesta corta escritas a partir de tu material.', icon: 'exam' },
      { title: 'Recibe tu corrección', text: 'Consulta tu nota y comentarios sobre cada respuesta, con el fragmento del que procede.', icon: 'graded' },
      { title: 'Practica tus temas débiles', text: 'Exama sigue cada tema según tus resultados y prepara práctica sobre los que te cuestan.', icon: 'target' },
      { title: 'Sigue tu plan de estudio', text: 'Un plan día a día hasta la fecha de tu examen que se adapta a medida que estudias.', icon: 'calendar' },
    ],
  },
  materials: {
    eyebrow: 'Material compatible',
    title: 'Trae todo aquello de lo que está hecho tu curso',
    lead: 'PDF, diapositivas, grabaciones y vídeos de clase alimentan el mismo curso. Tus exámenes, tu práctica y tu plan de estudio usan todo lo que añades.',
    items: [
      { name: 'PDF', icon: 'pdf', formats: '.pdf', text: 'Apuntes, capítulos de libros, notas a ordenador. Funciona mejor con texto seleccionable: los PDF escaneados o solo con imágenes todavía no son compatibles.' },
      { name: 'PowerPoint', icon: 'slides', formats: '.pptx', text: 'Las diapositivas de tus clases. Las diapositivas que solo contienen imágenes todavía no son compatibles. ¿Tienes un .ppt antiguo? Guárdalo antes como .pptx o PDF.' },
      { name: 'Audio', icon: 'audio', formats: 'MP3 · M4A · WAV', text: 'Grabaciones de clase. Exama transcribe la clase y después encuentra los temas que trata.' },
      { name: 'Vídeo', icon: 'video', formats: 'MP4 · MOV', text: 'Vídeos de clase. Exama usa lo que se dice: las diapositivas o los diagramas que se muestran pero no se explican en voz alta no se recogen.' },
    ],
    fineTrial: 'Las clases en audio y vídeo están incluidas en Student y Pro, también durante su prueba gratuita. Free incluye una clase por cuenta. Basic cubre PDF y PowerPoint.',
    fineFree: 'Las clases en audio y vídeo están incluidas en Student y Pro. Free incluye una clase por cuenta. Basic cubre PDF y PowerPoint.',
  },
  grounded: {
    eyebrow: 'Aprendizaje basado en tus fuentes',
    title: 'Tu material, no una IA genérica',
    lead: 'Exama no te pregunta sobre lo que una IA sepa por casualidad. Crea preguntas y práctica a partir de lo que tu curso enseña de verdad: tus diapositivas, tus apuntes, tus clases.',
    points: [
      'Cada pregunta se comprueba con tu material. Si no se puede vincular a un fragmento, se descarta.',
      'Tus resultados muestran el fragmento del que salió cada pregunta, para que veas de dónde viene la respuesta.',
      'Las clases se transcriben y analizan igual que los documentos.',
      'Estudia en español, inglés, francés o árabe, aunque tu material esté en otro idioma.',
    ],
    disclaimer: 'Exama es una IA y puede equivocarse. Comprueba los datos importantes con tu curso.',
    contrastAria: 'Preguntas genéricas comparadas con las preguntas de Exama',
    genericLabel: 'Preguntas genéricas',
    genericText: 'Escritas a partir de conocimientos generales. Pueden tratar cosas que tu profesor nunca explicó.',
    examaLabel: 'Preguntas de Exama',
    examaText: 'Escritas a partir de tus diapositivas, apuntes y clases, cada una vinculada a un fragmento de tu material.',
    sourceNote: 'El fragmento de origen aparece con tus resultados',
  },
  exams: {
    eyebrow: 'Exámenes personalizados',
    title: 'Un examen hecho a partir de tu curso',
    lead: 'Elige un curso y Exama redacta el examen a partir de tu material. Responde, envía y recibe tu corrección.',
    pipelineAria: 'Cómo funciona un examen',
    steps: ['Subes tu material', 'Exama crea un examen', 'Respondes', 'Recibes tu corrección'],
    details: [
      { title: 'Dos tipos de pregunta', text: 'Preguntas tipo test y de respuesta corta. Tú eliges la duración del examen.', icon: 'exam' },
      { title: 'Corrección con comentarios', text: 'Las preguntas tipo test se corrigen al instante. Las respuestas cortas se evalúan según tu material, con comentarios en cada una.', icon: 'graded' },
      { title: 'Consulta la fuente', text: 'Cada resultado muestra el fragmento de tu material del que se escribió la pregunta.', icon: 'quote' },
      { title: 'En tu idioma', text: 'Estudia en español, inglés, francés o árabe, sea cual sea el idioma de tu material.', icon: 'globe' },
    ],
  },
  weak: {
    eyebrow: 'Temas débiles y práctica dirigida',
    title: 'Descubre lo que aún no sabes y ponle remedio',
    lead: 'Cada respuesta corregida actualiza cuánto dominas ese tema. Exama señala tus temas débiles y prepara práctica sobre ellos, además de exámenes de seguimiento centrados en los temas y errores que necesitan trabajo.',
    loopAria: 'El ciclo de estudio',
    steps: ['Estudia', 'Ponte a prueba', 'Detecta puntos débiles', 'Practícalos', 'Mejora'],
    back: 'y vuelta a empezar',
    fineTrial: 'El análisis de temas débiles y la práctica adaptativa forman parte de Student y Pro, también durante su prueba gratuita. Con Free y Basic practicas todos los temas de tu curso.',
    fineFree: 'El análisis de temas débiles y la práctica adaptativa forman parte de Student y Pro. Con Free y Basic practicas todos los temas de tu curso.',
  },
  plan: {
    eyebrow: 'Plan de estudio personalizado',
    title: 'Un plan de estudio que conoce la fecha de tu examen',
    lead: 'Dile a Exama cuándo es tu examen, cuántos minutos al día puedes estudiar y cómo de preparado te sientes. Planifica cada día hasta el examen a partir del material de tu curso y de tus resultados.',
    inputsTitle: 'Qué alimenta tu plan',
    inputs: [
      { title: 'El material de tu curso', text: 'Los temas que cubre tu curso y su importancia.', icon: 'folder' },
      { title: 'Tus resultados', text: 'Qué temas dominas y cuáles se te siguen resistiendo.', icon: 'chart' },
      { title: 'Tu horario', text: 'La fecha de tu examen, los minutos al día y los días en que puedes estudiar.', icon: 'clock' },
    ],
    outputsTitle: 'Lo que obtienes',
    outputs: [
      'Un plan para cada día hasta tu examen.',
      'Aprender, practicar, repasar y un repaso final, con más tiempo para los temas más débiles e importantes.',
      'Se vuelve a planificar cuando completas, omites o te saltas una tarea.',
      'Las tareas de hoy y tu progreso, en un solo lugar.',
    ],
    fineTrial: 'El plan que se adapta a tus resultados forma parte de Student y Pro, también durante su prueba gratuita. Free y Basic incluyen un planificador que reparte tus temas de forma uniforme.',
    fineFree: 'El plan que se adapta a tus resultados forma parte de Student y Pro. Free y Basic incluyen un planificador que reparte tus temas de forma uniforme.',
  },
  product: {
    eyebrow: 'Dentro de Exama',
    title: 'Todo lo que necesitas, en una sola app',
    lead: 'Tus materiales, tus exámenes, tus resultados, tus temas débiles y tu plan de estudio, todo creado a partir del mismo curso.',
    areas: [
      { id: 'materials', title: 'Materiales del curso', text: 'Todos los PDF, presentaciones y clases de un curso en un solo lugar, con los temas que trata cada uno.', icon: 'folder', alt: 'La pantalla de materiales del curso en Exama' },
      { id: 'exams', title: 'Exámenes', text: 'Genera un examen a partir de un curso, responde las preguntas y envíalo.', icon: 'exam', alt: 'Un examen en Exama' },
      { id: 'results', title: 'Resultados', text: 'Tu nota, comentarios sobre cada respuesta y el fragmento de origen.', icon: 'graded', alt: 'La pantalla de resultados en Exama' },
      { id: 'weak-topics', title: 'Temas débiles', text: 'Tu progreso tema a tema, con tus puntos débiles señalados.', icon: 'target', alt: 'La pantalla de temas débiles en Exama' },
      { id: 'planner', title: 'Planificador de estudio', text: 'Las tareas de hoy y tu plan hasta el día del examen.', icon: 'calendar', alt: 'El planificador de estudio en Exama' },
    ],
  },
  pricing: {
    eyebrow: 'Precios',
    titleTrial: (days) => `Empieza con ${days} días gratis`,
    titleFree: 'Empieza gratis y mejora tu plan cuando lo necesites',
    leadTrial: (days) => `Prueba gratis el plan que elijas durante ${days} días, con acceso completo a todo lo que incluye. Sin pago hoy, y puedes cancelar en cualquier momento antes de que termine la prueba.`,
    leadFree: 'Usa Exama con el plan Free, sin coste y sin tarjeta. Los planes de pago añaden más cursos, clases y práctica adaptativa.',
    recommended: 'Recomendado',
    perMonth: '/mes',
    orYearly: (yearly, pct) => `o ${yearly}/año · ahorra un ${pct} %`,
    zero: '0 €',
    noPayment: 'Sin pago',
    plans: {
      free: {
        name: 'Free',
        tagline: 'Prueba Exama con un curso.',
        features: [{ text: 'PDF y PowerPoint (.pptx)' }, { text: 'Exámenes, práctica y un planificador de estudio' }, { text: '1 curso a la vez' }, { text: '1 clase en audio o vídeo por cuenta' }],
      },
      basic: {
        name: 'Basic',
        tagline: 'PDF y PowerPoint.',
        features: [{ text: 'PDF y PowerPoint (.pptx)' }, { text: 'Exámenes, práctica y un planificador de estudio' }, { text: 'Hasta 3 cursos a la vez' }, { text: 'Sin clases en audio ni vídeo', off: true }],
      },
      student: {
        name: 'Student',
        tagline: 'Todo tu material, aprendizaje personalizado.',
        features: [
          { text: 'Todo lo de Basic' },
          { text: 'Clases en audio y vídeo' },
          { text: 'Análisis de temas débiles y práctica adaptativa' },
          { text: 'Plan de estudio que se adapta a tus resultados' },
          { text: 'Hasta 15 cursos a la vez' },
        ],
      },
      pro: {
        name: 'Pro',
        tagline: 'El máximo uso de la IA.',
        features: [{ text: 'Todo lo de Student, con límites mucho más altos' }, { text: 'Hasta 50 cursos a la vez' }, { text: 'El mayor límite de uso de la IA' }],
      },
    },
    fineTrial: (days) =>
      `Los precios son precios de catálogo en euros. En la web pagas con tarjeta a través de Stripe y gestionas o cancelas cuando quieras desde Cuenta → Gestionar facturación. Introduces un método de pago al contratar, pero hoy no se cobra nada: tras la prueba de ${days} días empieza el plan elegido, salvo que canceles antes de que termine. Si te suscribes en una app móvil, el App Store o Google Play te cobra y muestra el precio de tu país. Una suscripción iniciada en cualquier sitio desbloquea tu cuenta en todas partes.`,
    fineFree: 'Los precios son precios de catálogo en euros. La pantalla de planes de la app Exama muestra los planes que puedes elegir para tu cuenta y cómo se cobran. Una suscripción iniciada en cualquier sitio desbloquea tu cuenta en todas partes.',
  },
  faq: {
    eyebrow: 'Preguntas',
    title: 'Preguntas frecuentes',
    items: (trial, days) => [
      {
        q: '¿Qué puedo subir a Exama?',
        a: [
          'PDF, presentaciones de PowerPoint (.pptx), grabaciones de audio (MP3, M4A, WAV) y vídeos (MP4, MOV). Puedes mezclarlos en un mismo curso: todo lo que añades alimenta los mismos exámenes, la misma práctica y el mismo plan de estudio.',
          trial
            ? 'Las clases en audio y vídeo están incluidas en Student y Pro, también durante su prueba gratuita. Free incluye una clase por cuenta; Basic cubre PDF y PowerPoint.'
            : 'Las clases en audio y vídeo están incluidas en Student y Pro. Free incluye una clase por cuenta; Basic cubre PDF y PowerPoint.',
        ],
      },
      {
        q: '¿Cómo crea Exama mis exámenes?',
        a: [
          'Primero, Exama lee tu material e identifica los temas que enseña. Cuando pides un examen, redacta preguntas tipo test y de respuesta corta sobre esos temas a partir de tu contenido. Tú eliges la duración, respondes y envías para recibir tu corrección.',
        ],
      },
      {
        q: '¿Las preguntas se basan en el material de mi curso?',
        a: [
          'Sí. Las preguntas se escriben a partir de tu propio material y cada una tiene que estar respaldada por un fragmento: si una pregunta no se puede vincular a tu material, se descarta. Tus resultados muestran el fragmento para que puedas comprobarlo.',
          'Exama es una IA y aun así puede equivocarse, así que comprueba los datos importantes con tu curso.',
        ],
      },
      {
        q: '¿Exama entiende las clases grabadas?',
        a: [
          'Sí. Las clases en audio y vídeo se transcriben y analizan como cualquier otro material, y sus temas se suman a tu curso. Exama trabaja con lo que se dice: las diapositivas o los diagramas que se muestran en pantalla pero no se explican en voz alta no se recogen.',
          trial
            ? 'Las clases forman parte de Student y Pro, también durante su prueba gratuita; Free incluye una clase por cuenta, de la que usa los primeros 45 minutos.'
            : 'Las clases forman parte de Student y Pro; Free incluye una clase por cuenta, de la que usa los primeros 45 minutos.',
        ],
      },
      ...(trial
        ? [
            {
              q: `¿Cómo funciona la prueba gratuita de ${days} días?`,
              a: [
                `Cada cuenta puede empezar una prueba gratuita de ${days} días. Crea tu cuenta de Exama en app.exama.app, elige Basic, Student o Pro y empieza la prueba al contratar. Durante la prueba tienes acceso completo al plan que elijas, con todo lo que incluye.`,
                `Introduces un método de pago al contratar (lo gestiona Stripe), pero hoy no se cobra nada. Si no haces nada, el plan elegido empieza automáticamente al terminar los ${days} días. Cancela en cualquier momento antes desde Cuenta → Gestionar facturación y no se te cobrará.`,
                '¿Ya tienes cuenta? Inicia sesión y elige tu plan: la prueba se ofrece si tu cuenta todavía no la ha usado. La prueba funciona en cualquier navegador. Una suscripción iniciada en una app móvil, donde esté disponible, la cobra el App Store o Google Play y desbloquea la misma cuenta.',
              ],
            },
            {
              q: '¿Qué pasa después de la prueba?',
              a: [
                `Cuando terminan los ${days} días, empieza el plan que elegiste y se cobra su precio en tu tarjeta, salvo que canceles antes de que termine la prueba. Si cancelas durante la prueba, pasas al plan Free en cuanto se confirma la cancelación y conservas tus cursos y tu progreso.`,
                'Después puedes cancelar o cambiar de plan cuando quieras desde Cuenta → Gestionar facturación; un plan cancelado sigue funcionando hasta el final del periodo que pagaste.',
              ],
            },
          ]
        : [
            {
              q: '¿Puedo usar Exama gratis?',
              a: [
                'Sí. El plan Free no cuesta nada y no necesita tarjeta: un curso a la vez, PDF y PowerPoint, exámenes, práctica y un planificador de estudio, y una clase en audio o vídeo por cuenta.',
                'Crea tu cuenta en app.exama.app o inicia sesión si ya tienes una.',
              ],
            },
            {
              q: '¿Cómo elijo un plan de pago?',
              a: [
                'Inicia sesión en la app Exama y abre la pantalla de planes (desde Cuenta o desde cualquier botón para mejorar tu plan). Muestra los planes que puedes elegir para tu cuenta, su precio y cómo se cobran. Tus cursos y tu progreso se quedan en tu cuenta sea cual sea tu plan.',
              ],
            },
          ]),
      {
        q: '¿Exama solo sirve para archivos PDF?',
        a: ['No. Los PDF son solo una opción. Exama también funciona con presentaciones de PowerPoint, grabaciones de audio y vídeos, todo en el mismo curso.'],
      },
    ],
  },
  final: {
    title: 'Pon a trabajar el material de tu curso.',
    text: 'Súbelo una vez. Obtén exámenes, corrección, práctica de temas débiles y un plan de estudio hechos a partir de él.',
    noteTrial: (days) => `${days} días gratis · Se pide una tarjeta, sin pago hoy · Cancela cuando quieras antes de que termine`,
    noteFree: 'Plan gratuito · Sin tarjeta · ¿Ya tienes cuenta? Inicia sesión',
  },
  footer: {
    tagline: 'Tu entrenador de exámenes con IA, creado a partir del material de tu propio curso.',
    openApp: 'Abrir la app Exama',
    product: 'Producto',
    legalHelp: 'Legal y ayuda',
    account: 'Cuenta',
    links: { how: 'Cómo funciona', materials: 'Material compatible', pricing: 'Precios', faq: 'Preguntas frecuentes', privacy: 'Privacidad', terms: 'Condiciones', support: 'Ayuda', login: 'Iniciar sesión', loginStudent: 'Entrar como estudiante', loginOrganization: 'Entrar como organización', signup: 'Crear una cuenta', students: 'Para estudiantes', organizations: 'Para organizaciones' },
  },
  support: {
    title: 'Ayuda',
    description: 'Obtén ayuda con Exama.',
    intro: '¿Tienes preguntas, problemas o comentarios? En la app Exama, abre Cuenta → Ayuda y soporte para ver respuestas a preguntas frecuentes y ponerte en contacto.',
    openApp: 'Abrir la app Exama',
    emailLead: 'También puedes escribirnos a',
    noEmail: 'Antes del lanzamiento indicaremos aquí una dirección de correo de soporte.',
    faqLead: '¿Buscas una respuesta sobre subidas, exámenes o planes?',
    faqLink: 'Consulta las preguntas frecuentes',
    back: '← Volver a exama.app',
  },
};
