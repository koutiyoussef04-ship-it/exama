/**
 * In-app Privacy Policy and Terms of Use (all launch languages).
 *
 * ⚠ DRAFT TEMPLATES — complete the [bracketed] details and have them reviewed (ideally by a lawyer)
 * before submitting to the App Store. The English master copies live in docs/legal/.
 * They describe only what the app actually does today (see docs/privacy/data-inventory.md);
 * update both whenever data handling changes.
 *
 * Placeholders filled at runtime from app config: {{company}}, {{email}}, {{address}}.
 */
import type { Language } from '@study/shared';

export type LegalSection = { heading: string; body: string };
export type LegalDoc = { title: string; sections: LegalSection[] };
export type LegalDocs = { privacy: LegalDoc; terms: LegalDoc };

/** Date of the current text (ISO). Update when the content changes. */
export const LEGAL_UPDATED = '2026-09-27';
/** Set to false once the [bracketed] details are completed and reviewed. */
export const LEGAL_IS_DRAFT = true;

const en: LegalDocs = {
  privacy: {
    title: 'Privacy Policy',
    sections: [
      { heading: 'Who we are', body: 'Exama is operated by {{company}}, {{address}}. Questions about privacy: {{email}}.' },
      {
        heading: 'Data we collect',
        body:
          '• Account: your first name, email address and password (stored only as a secure hash).\n' +
          '• Study content: the PDFs, PowerPoint files and lecture recordings (audio or video) you upload, the text and transcripts extracted from them, generated summaries, topics, questions and feedback, your answers, scores and topic progress.\n' +
          '• Subscription: your plan, its status and dates, and the App Store or Google Play transaction identifiers. We never receive your card or payment details — payments are handled by Apple or Google.\n' +
          '• Usage data: product events (for example “app opened” or “exam completed”) with identifiers, counts, scores, durations, your app and study language, your platform and a random identifier for your installation. We never record the content of your PDFs, questions or answers in analytics.\n' +
          'We do not collect your location, contacts, photos or advertising identifiers, and we do not track you across other apps or websites.',
      },
      {
        heading: 'How we use it',
        body: 'To provide Exama (processing your material, generating exams and practice, grading and tracking your progress), to apply your plan and its limits, to keep the service secure, to answer support requests and to improve the product using aggregated usage statistics. We do not sell your data and do not show advertising.',
      },
      {
        heading: 'AI processing',
        body: 'To create summaries, questions and feedback, excerpts of your material and your written answers are sent to our AI provider, Anthropic (Claude), which processes them on our behalf. Lecture recordings you add are sent to our transcription provider, AssemblyAI, to turn speech into text; we ask it to delete each transcript as soon as we have received it. [Confirm the providers’ data-retention and training terms that apply to your accounts and describe them here.]',
      },
      {
        heading: 'Service providers',
        body: 'We use providers to run Exama: [hosting provider and region], [database provider], Anthropic (AI processing), AssemblyAI (transcription of lecture recordings), Apple and Google (subscriptions and payments in their app stores). They may only use your data to provide their service to us.',
      },
      {
        heading: 'Retention and deletion',
        body: 'We keep your data while your account exists. Deleting a course removes its PDF or PowerPoint file, added materials, exams and progress. Lecture recordings are deleted as soon as they have been transcribed (we keep the transcript as part of your course); a recording that could not be processed is kept for up to 7 days so you can retry, then deleted. Deleting your account (Account → Delete account) permanently removes your account, courses, files, exams, progress and subscription records; usage statistics are kept only in anonymous form. [State how long backups are kept.]',
      },
      {
        heading: 'Your rights',
        body: 'Depending on where you live, you can ask to access, correct, export or delete your data, or object to certain processing. You can delete your account in the app at any time. Contact {{email}} for other requests. You may also complain to your data protection authority.',
      },
      { heading: 'Security', body: 'Data is sent over encrypted connections (HTTPS), passwords are hashed, and each account can only access its own data.' },
      { heading: 'Children', body: 'Exama is intended for students aged [13/16] and over. [Confirm the minimum age for your markets.]' },
      { heading: 'International transfers', body: '[Describe where data is stored and processed and the safeguards used for transfers, if any.]' },
      { heading: 'Changes', body: 'We will update this policy when our practices change and show the date of the latest version at the top.' },
    ],
  },
  terms: {
    title: 'Terms of Use',
    sections: [
      { heading: 'Agreement', body: 'These terms apply to your use of Exama, provided by {{company}}, {{address}}. By creating an account you agree to them.' },
      {
        heading: 'The service',
        body: 'Exama helps you study your own course material with AI-generated summaries, exams, practice questions and feedback. AI output can be incomplete or wrong: always check important information against your course and your teachers. Exama is not affiliated with your school or university.',
      },
      { heading: 'Your account', body: 'Keep your password secret and your details accurate. You are responsible for activity on your account. One free trial is available per account.' },
      {
        heading: 'Your content',
        body: 'You keep all rights to the material you upload. Only upload material you are allowed to use — for lecture recordings, that includes any permission your lecturer or institution requires to record and use them. You give us permission to store and process it only to provide Exama to you (including AI processing as described in the Privacy Policy).',
      },
      { heading: 'Acceptable use', body: 'Do not misuse Exama: no unlawful content, no attempts to access other accounts, no automated scraping, and no attempts to get around plan limits.' },
      {
        heading: 'Subscriptions and free trial',
        body:
          'Basic, Student and Pro are auto-renewing subscriptions (monthly or yearly) sold through the App Store (billed to your Apple ID) and Google Play (billed to your Google account). A 7-day free trial may be offered once per account; it includes a limited allowance (shown before you start). Unless you cancel at least 24 hours before the end of the trial or current period, the subscription renews automatically at the price shown. Manage or cancel it in the account settings of the store you subscribed with. Refunds are handled by that store. A subscription works on every device where you sign in to Exama, including the web version. Deleting the app or your account does not cancel a subscription.',
      },
      { heading: 'Plan limits', body: 'Each plan includes fair-use allowances (courses, uploads, exams and practice questions) shown in the app. Limits may change for future billing periods with notice.' },
      { heading: 'Ending your use', body: 'You can delete your account at any time in the app. We may suspend accounts that seriously or repeatedly break these terms.' },
      { heading: 'Disclaimers and liability', body: '[Add the warranty disclaimer and limitation of liability appropriate for your jurisdiction. Nothing in these terms limits rights you have under mandatory consumer law.]' },
      { heading: 'Governing law', body: '[Country/state whose law applies and competent courts.]' },
      { heading: 'Contact', body: 'Questions about these terms: {{email}}.' },
    ],
  },
};

const es: LegalDocs = {
  privacy: {
    title: 'Política de privacidad',
    sections: [
      { heading: 'Quiénes somos', body: 'Exama está gestionada por {{company}}, {{address}}. Consultas sobre privacidad: {{email}}.' },
      {
        heading: 'Datos que recopilamos',
        body:
          '• Cuenta: tu nombre, tu correo electrónico y tu contraseña (guardada solo como un hash seguro).\n' +
          '• Contenido de estudio: los PDF, los archivos de PowerPoint y las grabaciones de clase (audio o vídeo) que subes, el texto y las transcripciones extraídos, los resúmenes, temas, preguntas y correcciones generados, tus respuestas, puntuaciones y progreso por tema.\n' +
          '• Suscripción: tu plan, su estado y fechas, y los identificadores de transacción del App Store o de Google Play. Nunca recibimos los datos de tu tarjeta ni de pago: los pagos los gestionan Apple o Google.\n' +
          '• Datos de uso: eventos del producto (por ejemplo, «app abierta» o «examen completado») con identificadores, recuentos, puntuaciones, duraciones, tu idioma de la app y de estudio, tu plataforma y un identificador aleatorio de tu instalación. Nunca registramos en la analítica el contenido de tus PDF, preguntas o respuestas.\n' +
          'No recopilamos tu ubicación, contactos, fotos ni identificadores publicitarios, y no te rastreamos en otras apps o sitios web.',
      },
      {
        heading: 'Cómo los usamos',
        body: 'Para prestar Exama (procesar tu material, generar exámenes y prácticas, corregir y seguir tu progreso), aplicar tu plan y sus límites, mantener la seguridad del servicio, responder a solicitudes de soporte y mejorar el producto con estadísticas de uso agregadas. No vendemos tus datos ni mostramos publicidad.',
      },
      {
        heading: 'Procesamiento con IA',
        body: 'Para crear resúmenes, preguntas y correcciones, se envían fragmentos de tu material y tus respuestas escritas a nuestro proveedor de IA, Anthropic (Claude), que los procesa por cuenta nuestra. Las grabaciones de clase que añades se envían a nuestro proveedor de transcripción, AssemblyAI, para convertir la voz en texto; le pedimos que elimine cada transcripción en cuanto la recibimos. [Confirma y describe aquí las condiciones de conservación y entrenamiento de los proveedores que se aplican a tus cuentas.]',
      },
      {
        heading: 'Proveedores de servicios',
        body: 'Usamos proveedores para operar Exama: [proveedor y región de alojamiento], [proveedor de base de datos], Anthropic (procesamiento con IA), AssemblyAI (transcripción de grabaciones de clase), Apple y Google (suscripciones y pagos en sus tiendas de apps). Solo pueden usar tus datos para prestarnos su servicio.',
      },
      {
        heading: 'Conservación y eliminación',
        body: 'Conservamos tus datos mientras exista tu cuenta. Al eliminar un curso se borran su PDF o PowerPoint, los materiales añadidos, los exámenes y el progreso. Las grabaciones de clase se eliminan en cuanto se transcriben (conservamos la transcripción como parte de tu curso); una grabación que no se pudo procesar se guarda hasta 7 días para que puedas reintentarlo y después se elimina. Al eliminar tu cuenta (Cuenta → Eliminar cuenta) se borran de forma permanente tu cuenta, cursos, archivos, exámenes, progreso y registros de suscripción; las estadísticas de uso solo se conservan de forma anónima. [Indica cuánto tiempo se conservan las copias de seguridad.]',
      },
      {
        heading: 'Tus derechos',
        body: 'Según dónde vivas, puedes solicitar el acceso, la rectificación, la portabilidad o la supresión de tus datos, u oponerte a ciertos tratamientos. Puedes eliminar tu cuenta en la app en cualquier momento. Para otras solicitudes, escribe a {{email}}. También puedes reclamar ante tu autoridad de protección de datos.',
      },
      { heading: 'Seguridad', body: 'Los datos se envían por conexiones cifradas (HTTPS), las contraseñas se guardan como hash y cada cuenta solo puede acceder a sus propios datos.' },
      { heading: 'Menores', body: 'Exama está dirigida a estudiantes de [13/16] años o más. [Confirma la edad mínima para tus mercados.]' },
      { heading: 'Transferencias internacionales', body: '[Describe dónde se almacenan y procesan los datos y las garantías aplicadas a las transferencias, si las hay.]' },
      { heading: 'Cambios', body: 'Actualizaremos esta política cuando cambien nuestras prácticas e indicaremos arriba la fecha de la última versión.' },
    ],
  },
  terms: {
    title: 'Condiciones de uso',
    sections: [
      { heading: 'Aceptación', body: 'Estas condiciones se aplican al uso de Exama, ofrecida por {{company}}, {{address}}. Al crear una cuenta las aceptas.' },
      {
        heading: 'El servicio',
        body: 'Exama te ayuda a estudiar tu propio material de clase con resúmenes, exámenes, preguntas de práctica y correcciones generados por IA. La IA puede ser incompleta o equivocarse: comprueba siempre la información importante con tu curso y tus profesores. Exama no está afiliada a tu centro de estudios.',
      },
      { heading: 'Tu cuenta', body: 'Mantén tu contraseña en secreto y tus datos actualizados. Eres responsable de la actividad de tu cuenta. Se ofrece una única prueba gratuita por cuenta.' },
      {
        heading: 'Tu contenido',
        body: 'Conservas todos los derechos sobre el material que subes. Sube solo material que tengas derecho a usar; en el caso de grabaciones de clase, eso incluye el permiso que exijan tu profesor o tu institución para grabarlas y usarlas. Nos autorizas a almacenarlo y procesarlo únicamente para prestarte Exama (incluido el procesamiento con IA descrito en la Política de privacidad).',
      },
      { heading: 'Uso aceptable', body: 'No hagas un uso indebido de Exama: nada de contenido ilícito, intentos de acceder a otras cuentas, extracción automatizada ni intentos de eludir los límites del plan.' },
      {
        heading: 'Suscripciones y prueba gratuita',
        body:
          'Basic, Student y Pro son suscripciones de renovación automática (mensuales o anuales) vendidas a través del App Store (cobradas a tu Apple ID) y de Google Play (cobradas a tu cuenta de Google). Puede ofrecerse una prueba gratuita de 7 días una sola vez por cuenta; incluye un límite reducido (se muestra antes de empezar). Salvo que canceles al menos 24 horas antes del final de la prueba o del periodo actual, la suscripción se renueva automáticamente al precio indicado. Gestiónala o cancélala en los ajustes de la cuenta de la tienda con la que te suscribiste. Los reembolsos los gestiona esa tienda. La suscripción funciona en todos los dispositivos donde inicies sesión en Exama, incluida la versión web. Borrar la app o tu cuenta no cancela la suscripción.',
      },
      { heading: 'Límites del plan', body: 'Cada plan incluye límites de uso razonable (cursos, subidas, exámenes y preguntas de práctica) que se muestran en la app. Pueden cambiar en periodos de facturación futuros con aviso previo.' },
      { heading: 'Fin del uso', body: 'Puedes eliminar tu cuenta en cualquier momento desde la app. Podemos suspender cuentas que incumplan estas condiciones de forma grave o reiterada.' },
      { heading: 'Exenciones y responsabilidad', body: '[Añade la exención de garantías y la limitación de responsabilidad adecuadas a tu jurisdicción. Nada de lo aquí dispuesto limita los derechos que te otorga la normativa obligatoria de consumo.]' },
      { heading: 'Legislación aplicable', body: '[País/estado cuya ley se aplica y tribunales competentes.]' },
      { heading: 'Contacto', body: 'Preguntas sobre estas condiciones: {{email}}.' },
    ],
  },
};

const fr: LegalDocs = {
  privacy: {
    title: 'Politique de confidentialité',
    sections: [
      { heading: 'Qui sommes-nous', body: 'Exama est exploitée par {{company}}, {{address}}. Questions relatives à la confidentialité : {{email}}.' },
      {
        heading: 'Données collectées',
        body:
          '• Compte : votre prénom, votre adresse e-mail et votre mot de passe (conservé uniquement sous forme de hachage sécurisé).\n' +
          '• Contenus d’étude : les PDF, fichiers PowerPoint et enregistrements de cours (audio ou vidéo) que vous importez, le texte et les transcriptions extraits, les résumés, thèmes, questions et corrections générés, vos réponses, scores et progrès par thème.\n' +
          '• Abonnement : votre offre, son statut et ses dates, ainsi que les identifiants de transaction App Store ou Google Play. Nous ne recevons jamais vos données de carte ou de paiement — les paiements sont gérés par Apple ou Google.\n' +
          '• Données d’utilisation : événements produit (par exemple « app ouverte » ou « examen terminé ») avec des identifiants, comptages, scores, durées, votre langue d’app et d’étude, votre plateforme et un identifiant aléatoire de votre installation. Nous n’enregistrons jamais le contenu de vos PDF, questions ou réponses dans les statistiques.\n' +
          'Nous ne collectons ni votre position, ni vos contacts, ni vos photos, ni d’identifiant publicitaire, et nous ne vous suivons pas sur d’autres apps ou sites.',
      },
      {
        heading: 'Utilisation des données',
        body: 'Pour fournir Exama (traiter vos supports, générer examens et entraînements, corriger et suivre vos progrès), appliquer votre offre et ses limites, sécuriser le service, répondre aux demandes d’assistance et améliorer le produit à l’aide de statistiques agrégées. Nous ne vendons pas vos données et n’affichons pas de publicité.',
      },
      {
        heading: 'Traitement par l’IA',
        body: 'Pour créer résumés, questions et corrections, des extraits de vos supports et vos réponses rédigées sont envoyés à notre fournisseur d’IA, Anthropic (Claude), qui les traite pour notre compte. Les enregistrements de cours que vous ajoutez sont envoyés à notre prestataire de transcription, AssemblyAI, pour convertir la parole en texte ; nous lui demandons de supprimer chaque transcription dès que nous l’avons reçue. [Confirmez et décrivez ici les conditions de conservation et d’entraînement des prestataires applicables à vos comptes.]',
      },
      {
        heading: 'Prestataires',
        body: 'Nous faisons appel à des prestataires pour faire fonctionner Exama : [hébergeur et région], [fournisseur de base de données], Anthropic (traitement IA), AssemblyAI (transcription des enregistrements de cours), Apple et Google (abonnements et paiements dans leurs boutiques d’applications). Ils ne peuvent utiliser vos données que pour nous fournir leur service.',
      },
      {
        heading: 'Conservation et suppression',
        body: 'Nous conservons vos données tant que votre compte existe. Supprimer un cours efface son PDF ou PowerPoint, les supports ajoutés, ses examens et vos progrès. Les enregistrements de cours sont supprimés dès qu’ils ont été transcrits (nous conservons la transcription dans votre cours) ; un enregistrement qui n’a pas pu être traité est conservé 7 jours au maximum pour vous permettre de réessayer, puis supprimé. Supprimer votre compte (Compte → Supprimer le compte) efface définitivement votre compte, vos cours, fichiers, examens, progrès et données d’abonnement ; les statistiques d’utilisation ne sont conservées que sous forme anonyme. [Indiquez la durée de conservation des sauvegardes.]',
      },
      {
        heading: 'Vos droits',
        body: 'Selon votre pays, vous pouvez demander l’accès, la rectification, la portabilité ou l’effacement de vos données, ou vous opposer à certains traitements. Vous pouvez supprimer votre compte dans l’app à tout moment. Pour toute autre demande : {{email}}. Vous pouvez aussi saisir votre autorité de protection des données.',
      },
      { heading: 'Sécurité', body: 'Les données transitent par des connexions chiffrées (HTTPS), les mots de passe sont hachés et chaque compte n’accède qu’à ses propres données.' },
      { heading: 'Mineurs', body: 'Exama s’adresse aux étudiants de [13/16] ans et plus. [Confirmez l’âge minimum pour vos marchés.]' },
      { heading: 'Transferts internationaux', body: '[Décrivez où les données sont stockées et traitées et les garanties encadrant les transferts, le cas échéant.]' },
      { heading: 'Modifications', body: 'Nous mettrons à jour cette politique lorsque nos pratiques évolueront et indiquerons en haut la date de la dernière version.' },
    ],
  },
  terms: {
    title: 'Conditions d’utilisation',
    sections: [
      { heading: 'Acceptation', body: 'Ces conditions s’appliquent à votre utilisation d’Exama, fournie par {{company}}, {{address}}. En créant un compte, vous les acceptez.' },
      {
        heading: 'Le service',
        body: 'Exama vous aide à réviser vos propres supports de cours grâce à des résumés, examens, questions d’entraînement et corrections générés par l’IA. L’IA peut être incomplète ou se tromper : vérifiez toujours les informations importantes auprès de votre cours et de vos enseignants. Exama n’est pas affiliée à votre établissement.',
      },
      { heading: 'Votre compte', body: 'Gardez votre mot de passe secret et vos informations à jour. Vous êtes responsable de l’activité de votre compte. Un seul essai gratuit est proposé par compte.' },
      {
        heading: 'Vos contenus',
        body: 'Vous conservez tous les droits sur les supports que vous importez. N’importez que des contenus que vous avez le droit d’utiliser ; pour les enregistrements de cours, cela inclut l’autorisation éventuellement exigée par votre enseignant ou votre établissement pour les enregistrer et les utiliser. Vous nous autorisez à les stocker et à les traiter uniquement pour vous fournir Exama (y compris le traitement par l’IA décrit dans la Politique de confidentialité).',
      },
      { heading: 'Utilisation acceptable', body: 'N’utilisez pas Exama de manière abusive : aucun contenu illicite, aucune tentative d’accès à d’autres comptes, aucune extraction automatisée et aucun contournement des limites de l’offre.' },
      {
        heading: 'Abonnements et essai gratuit',
        body:
          'Basic, Student et Pro sont des abonnements à renouvellement automatique (mensuels ou annuels) vendus via l’App Store (facturés sur votre identifiant Apple) et Google Play (facturés sur votre compte Google). Un essai gratuit de 7 jours peut être proposé une seule fois par compte ; il comprend une allocation limitée (indiquée avant de commencer). Sauf résiliation au moins 24 heures avant la fin de l’essai ou de la période en cours, l’abonnement se renouvelle automatiquement au prix indiqué. Gérez-le ou résiliez-le dans les réglages du compte de la boutique où vous vous êtes abonné. Les remboursements sont gérés par cette boutique. L’abonnement fonctionne sur tous les appareils où vous vous connectez à Exama, y compris la version web. Supprimer l’app ou votre compte ne résilie pas l’abonnement.',
      },
      { heading: 'Limites des offres', body: 'Chaque offre comprend des allocations d’usage raisonnable (cours, imports, examens et questions d’entraînement) indiquées dans l’app. Elles peuvent évoluer pour les périodes de facturation futures, après information préalable.' },
      { heading: 'Fin d’utilisation', body: 'Vous pouvez supprimer votre compte à tout moment dans l’app. Nous pouvons suspendre les comptes qui enfreignent gravement ou de façon répétée ces conditions.' },
      { heading: 'Garanties et responsabilité', body: '[Ajoutez l’exclusion de garanties et la limitation de responsabilité adaptées à votre juridiction. Rien dans ces conditions ne limite les droits que vous confère le droit impératif de la consommation.]' },
      { heading: 'Droit applicable', body: '[Pays/État dont la loi s’applique et juridictions compétentes.]' },
      { heading: 'Contact', body: 'Questions sur ces conditions : {{email}}.' },
    ],
  },
};

const ar: LegalDocs = {
  privacy: {
    title: 'سياسة الخصوصية',
    sections: [
      { heading: 'من نحن', body: 'تُشغّل {{company}}، {{address}}، تطبيق Exama. للاستفسارات المتعلقة بالخصوصية: {{email}}.' },
      {
        heading: 'البيانات التي نجمعها',
        body:
          '• الحساب: اسمك الأول وبريدك الإلكتروني وكلمة المرور (تُخزَّن كتجزئة آمنة فقط).\n' +
          '• المحتوى الدراسي: ملفات PDF وملفات PowerPoint وتسجيلات المحاضرات (صوت أو فيديو) التي ترفعها، والنصوص والتفريغات النصية المستخرجة منها، والملخّصات والموضوعات والأسئلة والملاحظات المُنشأة، وإجاباتك ودرجاتك وتقدّمك في كل موضوع.\n' +
          '• الاشتراك: خطتك وحالتها وتواريخها ومعرّفات معاملات App Store أو Google Play. لا نتلقى أبدًا بيانات بطاقتك أو الدفع — تتولى Apple أو Google عمليات الدفع.\n' +
          '• بيانات الاستخدام: أحداث المنتج (مثل «فتح التطبيق» أو «إكمال اختبار») مع معرّفات وأعداد ودرجات ومدد ولغة التطبيق ولغة المذاكرة ونظام التشغيل ومعرّف عشوائي لتثبيتك. لا نسجّل أبدًا محتوى ملفات PDF أو الأسئلة أو الإجابات في الإحصاءات.\n' +
          'لا نجمع موقعك أو جهات اتصالك أو صورك أو معرّفات الإعلانات، ولا نتتبّعك عبر التطبيقات أو المواقع الأخرى.',
      },
      {
        heading: 'كيف نستخدمها',
        body: 'لتقديم Exama (معالجة مادتك، وإنشاء الاختبارات والتدريبات، والتصحيح ومتابعة تقدّمك)، وتطبيق خطتك وحدودها، والحفاظ على أمان الخدمة، والرد على طلبات الدعم، وتحسين المنتج باستخدام إحصاءات استخدام مجمّعة. لا نبيع بياناتك ولا نعرض إعلانات.',
      },
      {
        heading: 'المعالجة بالذكاء الاصطناعي',
        body: 'لإنشاء الملخّصات والأسئلة والملاحظات، تُرسل مقتطفات من مادتك وإجاباتك المكتوبة إلى مزوّد الذكاء الاصطناعي لدينا، Anthropic (Claude)، الذي يعالجها نيابةً عنا. وتُرسل تسجيلات المحاضرات التي تضيفها إلى مزوّد التفريغ النصي لدينا، AssemblyAI، لتحويل الكلام إلى نص، ونطلب منه حذف كل تفريغ نصي فور استلامنا له. [أكّد شروط الاحتفاظ بالبيانات والتدريب لدى المزوّدين التي تنطبق على حساباتك وصِفها هنا.]',
      },
      {
        heading: 'مزوّدو الخدمات',
        body: 'نستعين بمزوّدين لتشغيل Exama: [مزوّد الاستضافة والمنطقة]، [مزوّد قاعدة البيانات]، وAnthropic (المعالجة بالذكاء الاصطناعي)، وAssemblyAI (التفريغ النصي لتسجيلات المحاضرات)، وApple وGoogle (الاشتراكات والمدفوعات في متاجر التطبيقات الخاصة بهما). لا يجوز لهم استخدام بياناتك إلا لتقديم خدمتهم لنا.',
      },
      {
        heading: 'الاحتفاظ والحذف',
        body: 'نحتفظ ببياناتك طالما بقي حسابك قائمًا. يؤدي حذف مقرر إلى إزالة ملف PDF أو PowerPoint الخاص به والمواد المضافة واختباراته وتقدّمك. تُحذف تسجيلات المحاضرات فور تفريغها نصيًا (نحتفظ بالتفريغ النصي ضمن مقررك)، ويُحتفظ بالتسجيل الذي تعذّرت معالجته 7 أيام كحد أقصى لتتمكن من إعادة المحاولة ثم يُحذف. ويؤدي حذف حسابك (الحساب ← حذف الحساب) إلى إزالة حسابك ومقرراتك وملفاتك واختباراتك وتقدّمك وسجلات اشتراكك نهائيًا؛ ولا تُحفظ إحصاءات الاستخدام إلا بشكل مجهول الهوية. [اذكر مدة الاحتفاظ بالنسخ الاحتياطية.]',
      },
      {
        heading: 'حقوقك',
        body: 'بحسب مكان إقامتك، يمكنك طلب الوصول إلى بياناتك أو تصحيحها أو نقلها أو حذفها، أو الاعتراض على بعض أنواع المعالجة. يمكنك حذف حسابك من التطبيق في أي وقت. للطلبات الأخرى راسل {{email}}. ويمكنك أيضًا تقديم شكوى إلى الجهة المختصة بحماية البيانات.',
      },
      { heading: 'الأمان', body: 'تُرسل البيانات عبر اتصالات مشفّرة (HTTPS)، وتُخزَّن كلمات المرور كتجزئة، ولا يمكن لأي حساب الوصول إلا إلى بياناته.' },
      { heading: 'الأطفال', body: 'تطبيق Exama موجّه للطلاب الذين تبلغ أعمارهم [13/16] عامًا فأكثر. [أكّد الحد الأدنى للعمر في أسواقك.]' },
      { heading: 'النقل الدولي للبيانات', body: '[صِف أين تُخزَّن البيانات وتُعالج والضمانات المطبّقة على نقلها، إن وُجدت.]' },
      { heading: 'التغييرات', body: 'سنحدّث هذه السياسة عند تغيّر ممارساتنا، ونعرض تاريخ أحدث إصدار في الأعلى.' },
    ],
  },
  terms: {
    title: 'شروط الاستخدام',
    sections: [
      { heading: 'الموافقة', body: 'تنطبق هذه الشروط على استخدامك لتطبيق Exama المقدَّم من {{company}}، {{address}}. بإنشاء حساب، فإنك توافق عليها.' },
      {
        heading: 'الخدمة',
        body: 'يساعدك Exama على مذاكرة موادك الدراسية بملخّصات واختبارات وأسئلة تدريبية وملاحظات يُنشئها الذكاء الاصطناعي. قد تكون مخرجات الذكاء الاصطناعي ناقصة أو خاطئة: تحقّق دائمًا من المعلومات المهمة في مقررك ومع أساتذتك. Exama غير تابع لمؤسستك التعليمية.',
      },
      { heading: 'حسابك', body: 'حافظ على سرية كلمة المرور ودقة بياناتك. أنت مسؤول عن النشاط في حسابك. تتوفر فترة تجريبية مجانية واحدة لكل حساب.' },
      {
        heading: 'محتواك',
        body: 'تحتفظ بجميع الحقوق في المواد التي ترفعها. لا ترفع إلا ما يحق لك استخدامه، ويشمل ذلك في تسجيلات المحاضرات أي إذن يشترطه أستاذك أو مؤسستك لتسجيلها واستخدامها. تمنحنا الإذن بتخزينها ومعالجتها فقط لتقديم Exama لك (بما في ذلك المعالجة بالذكاء الاصطناعي الموضحة في سياسة الخصوصية).',
      },
      { heading: 'الاستخدام المقبول', body: 'لا تُسئ استخدام Exama: لا محتوى غير قانوني، ولا محاولات للوصول إلى حسابات أخرى، ولا استخراج آلي، ولا محاولات للتحايل على حدود الخطة.' },
      {
        heading: 'الاشتراكات والفترة التجريبية',
        body:
          'Basic وStudent وPro اشتراكات تتجدّد تلقائيًا (شهريًا أو سنويًا) وتُباع عبر App Store (ويُحاسَب عليها معرّف Apple الخاص بك) وGoogle Play (ويُحاسَب عليها حسابك في Google). قد تُتاح فترة تجريبية مجانية لمدة 7 أيام مرة واحدة فقط لكل حساب، وتتضمن حصة محدودة (تُعرض قبل البدء). ما لم تُلغِ قبل 24 ساعة على الأقل من نهاية الفترة التجريبية أو الفترة الحالية، يتجدّد الاشتراك تلقائيًا بالسعر المعروض. يمكنك إدارته أو إلغاؤه من إعدادات حسابك في المتجر الذي اشتركت منه. يتولى ذلك المتجر عمليات الاسترداد. يعمل الاشتراك على كل جهاز تسجّل فيه الدخول إلى Exama، بما في ذلك نسخة الويب. حذف التطبيق أو حسابك لا يلغي الاشتراك.',
      },
      { heading: 'حدود الخطط', body: 'تتضمن كل خطة حصص استخدام عادل (المقررات وعمليات الرفع والاختبارات والأسئلة التدريبية) المعروضة في التطبيق. قد تتغيّر في فترات الفوترة المستقبلية بعد إشعار مسبق.' },
      { heading: 'إنهاء الاستخدام', body: 'يمكنك حذف حسابك في أي وقت من التطبيق. يجوز لنا تعليق الحسابات التي تخالف هذه الشروط مخالفة جسيمة أو متكررة.' },
      { heading: 'إخلاء المسؤولية وحدودها', body: '[أضف إخلاء الضمانات وتحديد المسؤولية المناسبين لولايتك القضائية. لا شيء في هذه الشروط يقيّد حقوقك بموجب قوانين حماية المستهلك الإلزامية.]' },
      { heading: 'القانون الواجب التطبيق', body: '[الدولة/الولاية التي يُطبّق قانونها والمحاكم المختصة.]' },
      { heading: 'التواصل', body: 'للأسئلة حول هذه الشروط: {{email}}.' },
    ],
  },
};

export const LEGAL: Record<Language, LegalDocs> = { en, es, fr, ar };

/** Placeholder text shown until the business details are configured (see app.config.ts). */
export const LEGAL_MISSING: Record<Language, { company: string; email: string; address: string }> = {
  en: { company: '[company name]', email: '[contact email]', address: '[postal address]' },
  es: { company: '[nombre de la empresa]', email: '[correo de contacto]', address: '[dirección postal]' },
  fr: { company: '[nom de la société]', email: '[e-mail de contact]', address: '[adresse postale]' },
  ar: { company: '[اسم الشركة]', email: '[البريد الإلكتروني للتواصل]', address: '[العنوان البريدي]' },
};

export function fillLegal(text: string, values: { company: string; email: string; address: string }): string {
  return text.replace(/\{\{(company|email|address)\}\}/g, (_, k: keyof typeof values) => values[k]);
}
