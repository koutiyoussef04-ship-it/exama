/**
 * Reactivation campaign emails (services/reactivation-campaign.ts): copy and layout, four languages
 * (en, es for Spain, fr, ar), two audiences and two steps.
 *
 *   has_plan  → exam_upcoming | exam_passed   come back to the study plan you already made
 *   no_plan   → course_ready  | no_course     make your first study plan (or add your first course)
 *
 * Content rules: true to the product only. Everything stated here is something the app does for a Free
 * account (study plan from an exam date, minutes per task, change the date, exams made from the student's
 * own material, graded with feedback). No prices, discounts, trial or Student/Pro feature mentions, no
 * invented urgency (the only deadline mentioned is the student's own exam date), no results or personal
 * data beyond first name and course title. Every email names the sender, says why the person gets it (they chose marketing
 * emails: services/marketing-consent.ts) and carries a one-click unsubscribe that stops the MARKETING category only — the daily
 * study-plan email is a separate setting and says so (RFC 8058 header plus a link).
 */
import type { Mail } from '../lib/mailer.js';

export type Lang = 'en' | 'es' | 'fr' | 'ar';
export type Segment = 'has_plan' | 'no_plan';
export type Variant = 'exam_upcoming' | 'exam_passed' | 'course_ready' | 'no_course';
export type Step = 1 | 2;
export const LANGS: Lang[] = ['en', 'es', 'fr', 'ar'];
export const VARIANTS: Variant[] = ['exam_upcoming', 'exam_passed', 'course_ready', 'no_course'];
export const segmentOf = (v: Variant): Segment => (v === 'exam_upcoming' || v === 'exam_passed' ? 'has_plan' : 'no_plan');
/** Bump when any wording changes: the approval code of a send depends on it. */
export const TEMPLATES_VERSION = '2026-10-v2';

export type Sender = { name: string; address: string; supportEmail: string };
type P = { name: string; course: string; days: number };
type Body = { subject: (p: P) => string; preheader: string; lines: (p: P) => string[]; cta: string };
type Copy = {
  hello: (name: string) => string;
  /** The bit after "exam" for the count of days: tomorrow / in N days. */
  when: (days: number) => string;
  fallbackCourse: string;
  steps: Record<Step, Record<Variant, Body>>;
  foot: { why: string; stop: string; stopTail: string; sentBy: (s: Sender) => string };
};

const arDays = (d: number) => (d === 1 ? 'يوم واحد' : d === 2 ? 'يومين' : d <= 10 ? `${d} أيام` : `${d} يومًا`);

const COPY: Record<Lang, Copy> = {
  en: {
    hello: (n) => (n ? `Hi ${n},` : 'Hi,'),
    when: (d) => (d === 1 ? 'tomorrow' : `in ${d} days`),
    fallbackCourse: 'your course',
    steps: {
      1: {
        exam_upcoming: {
          subject: (p) => `Your ${p.course} exam is ${COPY.en.when(p.days)} — your plan is ready when you are`,
          preheader: 'A few minutes today keeps the plan on track.',
          lines: (p) => [
            `Your study plan for “${p.course}” is still in Exama, and your exam is ${COPY.en.when(p.days)}.`,
            'Open it to see what’s on for today. Each task shows how many minutes it should take, so you can fit it in between lectures.',
            'If your plans changed, you can move the exam date or rebuild the plan from the same screen.',
          ],
          cta: 'Open my study plan',
        },
        exam_passed: {
          subject: (p) => `How did the ${p.course} exam go?`,
          preheader: 'Got another exam coming up? Your next plan can start today.',
          lines: (p) => [
            `The exam date for “${p.course}” has passed. We hope it went well.`,
            'If another exam is on the horizon, add your notes, pick the date, and Exama spreads the topics over the days you have left, with a short list of tasks for each day.',
          ],
          cta: 'Plan my next exam',
        },
        course_ready: {
          subject: (p) => `Your “${p.course}” notes are in Exama — when’s the exam?`,
          preheader: 'A study plan turns “I should study” into a list for today.',
          lines: (p) => [
            `You added “${p.course}” to Exama, but there’s no study plan for it yet.`,
            'It takes a few quick questions: your exam date, how much time you have each day and how prepared you feel. Exama then spreads the topics over the days you have left and tells you what to do each day.',
          ],
          cta: 'Create my study plan',
        },
        no_course: {
          subject: () => 'Turn your notes into exams and a study plan',
          preheader: 'Start with one PDF or PowerPoint.',
          lines: () => [
            'Your Exama account is set up, but you haven’t added any course material yet.',
            'Upload a PDF or PowerPoint and Exama writes practice exams from your own material, grades your answers with feedback and, once you tell it your exam date, builds a day-by-day study plan.',
          ],
          cta: 'Add my first course',
        },
      },
      2: {
        exam_upcoming: {
          subject: (p) => `Still on for the ${p.course} exam?`,
          preheader: 'One task today is enough to get back into the rhythm.',
          lines: (p) => [
            `A quick nudge: your plan for “${p.course}” is waiting, and the exam is ${COPY.en.when(p.days)}.`,
            'One task today is enough to get back into the rhythm.',
          ],
          cta: 'Open my study plan',
        },
        exam_passed: {
          subject: () => 'And the next exam?',
          preheader: 'Add your notes and pick the date.',
          lines: () => ['When you have a date for your next exam, Exama builds the day-by-day plan from your own notes.'],
          cta: 'Plan my next exam',
        },
        course_ready: {
          subject: (p) => `A study plan for “${p.course}”: the short version`,
          preheader: 'Exam date, time per day, how prepared you feel.',
          lines: (p) => [`For “${p.course}” you only need three answers: your exam date, how much time you have each day and how prepared you feel. Exama does the scheduling.`],
          cta: 'Create my study plan',
        },
        no_course: {
          subject: () => 'One upload is all it takes to start',
          preheader: 'A PDF or PowerPoint of your course.',
          lines: () => ['Add one PDF or PowerPoint from your course and you’ll have exams made from it, with feedback on every answer. Add your exam date and you get a study plan too.'],
          cta: 'Add my first course',
        },
      },
    },
    foot: {
      why: 'You’re receiving this email because you chose to get tips, news and offers from Exama.',
      stop: 'Unsubscribe',
      stopTail: '(one click). Your daily study-plan email is a separate setting.',
      sentBy: (s) => `Sent by ${s.name}, ${s.address}. Questions: ${s.supportEmail}.`,
    },
  },
  es: {
    hello: (n) => (n ? `Hola, ${n}:` : 'Hola:'),
    when: (d) => (d === 1 ? 'mañana' : `en ${d} días`),
    fallbackCourse: 'tu curso',
    steps: {
      1: {
        exam_upcoming: {
          subject: (p) => `Tu examen de ${p.course} es ${COPY.es.when(p.days)}: tu plan te espera`,
          preheader: 'Unos minutos hoy te mantienen al día.',
          lines: (p) => [
            `Tu plan de estudio de «${p.course}» sigue en Exama y tu examen es ${COPY.es.when(p.days)}.`,
            'Ábrelo para ver qué toca hoy. Cada tarea indica cuántos minutos lleva, así que puedes encajarla entre clase y clase.',
            'Si te han cambiado los planes, puedes mover la fecha del examen o rehacer el plan desde la misma pantalla.',
          ],
          cta: 'Abrir mi plan de estudio',
        },
        exam_passed: {
          subject: (p) => `¿Qué tal el examen de ${p.course}?`,
          preheader: '¿Tienes otro examen a la vista? Tu próximo plan puede empezar hoy.',
          lines: (p) => [
            `El examen de «${p.course}» ya ha pasado. Esperamos que haya ido bien.`,
            'Si tienes otro examen en el horizonte, sube tus apuntes, elige la fecha y Exama reparte los temas entre los días que te quedan, con una lista corta de tareas para cada día.',
          ],
          cta: 'Planificar mi próximo examen',
        },
        course_ready: {
          subject: (p) => `Tus apuntes de «${p.course}» ya están en Exama: ¿para cuándo es el examen?`,
          preheader: 'Un plan de estudio convierte el «tengo que estudiar» en la lista de hoy.',
          lines: (p) => [
            `Añadiste «${p.course}» a Exama, pero todavía no tiene plan de estudio.`,
            'Bastan unas preguntas rápidas: la fecha del examen, cuánto tiempo tienes al día y cómo llevas la materia. Exama reparte los temas entre los días que te quedan y te dice qué hacer cada día.',
          ],
          cta: 'Crear mi plan de estudio',
        },
        no_course: {
          subject: () => 'Convierte tus apuntes en exámenes y un plan de estudio',
          preheader: 'Empieza con un PDF o un PowerPoint.',
          lines: () => [
            'Tu cuenta de Exama está lista, pero aún no has añadido material de ningún curso.',
            'Sube un PDF o un PowerPoint y Exama crea exámenes de práctica a partir de tus propios apuntes, corrige tus respuestas con comentarios y, cuando le digas la fecha de tu examen, te prepara un plan de estudio día a día.',
          ],
          cta: 'Añadir mi primer curso',
        },
      },
      2: {
        exam_upcoming: {
          subject: (p) => `¿Sigues con el examen de ${p.course}?`,
          preheader: 'Con una tarea hoy ya recuperas el ritmo.',
          lines: (p) => [`Un empujoncito: tu plan de «${p.course}» te espera y el examen es ${COPY.es.when(p.days)}.`, 'Con una sola tarea hoy ya recuperas el ritmo.'],
          cta: 'Abrir mi plan de estudio',
        },
        exam_passed: {
          subject: () => '¿Y el siguiente examen?',
          preheader: 'Sube tus apuntes y elige la fecha.',
          lines: () => ['Cuando tengas fecha para tu próximo examen, Exama te monta el plan día a día a partir de tus propios apuntes.'],
          cta: 'Planificar mi próximo examen',
        },
        course_ready: {
          subject: (p) => `Un plan de estudio para «${p.course}»: la versión corta`,
          preheader: 'Fecha del examen, tiempo al día, cómo llevas la materia.',
          lines: (p) => [`Para «${p.course}» solo necesitas tres respuestas: la fecha del examen, cuánto tiempo tienes al día y cómo llevas la materia. Exama se encarga de organizarlo.`],
          cta: 'Crear mi plan de estudio',
        },
        no_course: {
          subject: () => 'Con una sola subida ya puedes empezar',
          preheader: 'Un PDF o un PowerPoint de tu curso.',
          lines: () => ['Añade un PDF o un PowerPoint de tu curso y tendrás exámenes hechos a partir de él, con comentarios en cada respuesta. Si añades la fecha de tu examen, también tendrás plan de estudio.'],
          cta: 'Añadir mi primer curso',
        },
      },
    },
    foot: {
      why: 'Recibes este correo porque elegiste recibir consejos, novedades y ofertas de Exama.',
      stop: 'Darme de baja',
      stopTail: '(un clic). El correo diario con tu plan de estudio es un ajuste aparte.',
      sentBy: (s) => `Enviado por ${s.name}, ${s.address}. Dudas: ${s.supportEmail}.`,
    },
  },
  fr: {
    hello: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
    when: (d) => (d === 1 ? 'demain' : `dans ${d} jours`),
    fallbackCourse: 'votre cours',
    steps: {
      1: {
        exam_upcoming: {
          subject: (p) => `Votre examen de ${p.course} a lieu ${COPY.fr.when(p.days)} : votre plan vous attend`,
          preheader: 'Quelques minutes aujourd’hui suffisent pour rester dans le rythme.',
          lines: (p) => [
            `Votre plan de révision pour « ${p.course} » est toujours dans Exama, et votre examen a lieu ${COPY.fr.when(p.days)}.`,
            'Ouvrez-le pour voir le programme du jour. Chaque tâche indique sa durée en minutes, de quoi la caser entre deux cours.',
            'Si vos plans ont changé, vous pouvez déplacer la date de l’examen ou refaire le plan depuis le même écran.',
          ],
          cta: 'Ouvrir mon plan de révision',
        },
        exam_passed: {
          subject: (p) => `Comment s’est passé l’examen de ${p.course} ?`,
          preheader: 'Un autre examen se profile ? Votre prochain plan peut commencer aujourd’hui.',
          lines: (p) => [
            `La date de l’examen « ${p.course} » est passée. Nous espérons que tout s’est bien déroulé.`,
            'Un autre examen approche ? Ajoutez vos cours, choisissez la date et Exama répartit les thèmes sur les jours restants, avec une courte liste de tâches pour chaque jour.',
          ],
          cta: 'Préparer mon prochain examen',
        },
        course_ready: {
          subject: (p) => `Vos notes de « ${p.course} » sont dans Exama : pour quand est l’examen ?`,
          preheader: 'Un plan de révision transforme « je devrais réviser » en liste du jour.',
          lines: (p) => [
            `Vous avez ajouté « ${p.course} » à Exama, mais il n’y a pas encore de plan de révision.`,
            'Quelques questions rapides suffisent : la date de l’examen, le temps dont vous disposez chaque jour et où vous en êtes. Exama répartit les thèmes sur les jours qui restent et vous dit quoi faire chaque jour.',
          ],
          cta: 'Créer mon plan de révision',
        },
        no_course: {
          subject: () => 'Transformez vos cours en examens et en plan de révision',
          preheader: 'Commencez avec un PDF ou un PowerPoint.',
          lines: () => [
            'Votre compte Exama est créé, mais vous n’avez pas encore ajouté de cours.',
            'Importez un PDF ou un PowerPoint : Exama crée des examens d’entraînement à partir de vos propres cours, corrige vos réponses avec des commentaires et, dès que vous indiquez la date de votre examen, prépare un plan de révision jour par jour.',
          ],
          cta: 'Ajouter mon premier cours',
        },
      },
      2: {
        exam_upcoming: {
          subject: (p) => `Toujours partant pour l’examen de ${p.course} ?`,
          preheader: 'Une seule tâche aujourd’hui suffit pour retrouver le rythme.',
          lines: (p) => [`Un petit coup de pouce : votre plan pour « ${p.course} » vous attend, et l’examen a lieu ${COPY.fr.when(p.days)}.`, 'Une seule tâche aujourd’hui suffit pour retrouver le rythme.'],
          cta: 'Ouvrir mon plan de révision',
        },
        exam_passed: {
          subject: () => 'Et le prochain examen ?',
          preheader: 'Ajoutez vos cours et choisissez la date.',
          lines: () => ['Quand vous aurez une date pour votre prochain examen, Exama construit le plan jour par jour à partir de vos propres cours.'],
          cta: 'Préparer mon prochain examen',
        },
        course_ready: {
          subject: (p) => `Un plan de révision pour « ${p.course} » : la version courte`,
          preheader: 'Date de l’examen, temps par jour, où vous en êtes.',
          lines: (p) => [`Pour « ${p.course} », trois réponses suffisent : la date de l’examen, le temps dont vous disposez chaque jour et où vous en êtes. Exama s’occupe de l’organisation.`],
          cta: 'Créer mon plan de révision',
        },
        no_course: {
          subject: () => 'Un seul import suffit pour commencer',
          preheader: 'Un PDF ou un PowerPoint de votre cours.',
          lines: () => ['Ajoutez un PDF ou un PowerPoint de votre cours : vous aurez des examens créés à partir de celui-ci, avec des commentaires sur chaque réponse. Indiquez la date de votre examen et vous aurez aussi un plan de révision.'],
          cta: 'Ajouter mon premier cours',
        },
      },
    },
    foot: {
      why: 'Vous recevez cet e-mail parce que vous avez choisi de recevoir des conseils, des nouveautés et des offres d’Exama.',
      stop: 'Me désabonner',
      stopTail: '(un clic). L’e-mail quotidien avec votre plan de révision est un réglage distinct.',
      sentBy: (s) => `Envoyé par ${s.name}, ${s.address}. Une question : ${s.supportEmail}.`,
    },
  },
  ar: {
    hello: (n) => (n ? `مرحبًا ${n}،` : 'مرحبًا،'),
    when: (d) => (d === 1 ? 'غدًا' : `بعد ${arDays(d)}`),
    fallbackCourse: 'مقررك',
    steps: {
      1: {
        exam_upcoming: {
          subject: (p) => `اختبار ${p.course} ${COPY.ar.when(p.days)} — خطتك بانتظارك`,
          preheader: 'بضع دقائق اليوم تُبقيك على المسار.',
          lines: (p) => [
            `خطة مذاكرتك لمقرر «${p.course}» ما زالت في Exama، واختبارك ${COPY.ar.when(p.days)}.`,
            'افتحها لترى ما هو مقرر اليوم. كل مهمة تُظهر عدد الدقائق التي تحتاجها، فيسهل عليك إدخالها بين المحاضرات.',
            'إن تغيّرت خططك يمكنك تعديل موعد الاختبار أو إعادة بناء الخطة من الشاشة نفسها.',
          ],
          cta: 'افتح خطة المذاكرة',
        },
        exam_passed: {
          subject: (p) => `كيف كان اختبار ${p.course}؟`,
          preheader: 'هل لديك اختبار آخر قريبًا؟ خطتك القادمة تبدأ اليوم.',
          lines: (p) => [
            `مرّ موعد اختبار «${p.course}»، ونأمل أن يكون قد سار على ما يرام.`,
            'هل لديك اختبار آخر قريبًا؟ أضف ملاحظاتك واختر الموعد، وسيوزّع Exama المواضيع على الأيام المتبقية مع قائمة مهام قصيرة لكل يوم.',
          ],
          cta: 'خطّط لاختباري القادم',
        },
        course_ready: {
          subject: (p) => `ملاحظات «${p.course}» جاهزة في Exama — متى الاختبار؟`,
          preheader: 'الخطة تحوّل «يجب أن أذاكر» إلى قائمة مهام لليوم.',
          lines: (p) => [
            `أضفت «${p.course}» إلى Exama، لكن لا توجد لها خطة مذاكرة بعد.`,
            'تكفي بضعة أسئلة سريعة: موعد الاختبار، والوقت المتاح لك يوميًا، ومستوى استعدادك. يوزّع Exama المواضيع على الأيام المتبقية ويخبرك بما تفعله كل يوم.',
          ],
          cta: 'أنشئ خطة مذاكرتي',
        },
        no_course: {
          subject: () => 'حوّل ملاحظاتك إلى اختبارات وخطة مذاكرة',
          preheader: 'ابدأ بملف PDF أو عرض PowerPoint.',
          lines: () => [
            'حسابك في Exama جاهز، لكنك لم تضف مادة دراسية بعد.',
            'ارفع ملف PDF أو عرض PowerPoint، وسينشئ Exama اختبارات تدريبية من موادك أنت، ويصحّح إجاباتك مع ملاحظات، وعندما تخبره بموعد اختبارك يعدّ لك خطة مذاكرة يومًا بيوم.',
          ],
          cta: 'أضف أول مقرر لي',
        },
      },
      2: {
        exam_upcoming: {
          subject: (p) => `هل ما زال اختبار ${p.course} في بالك؟`,
          preheader: 'مهمة واحدة اليوم تكفي لاستعادة الإيقاع.',
          lines: (p) => [`تذكير سريع: خطتك لمقرر «${p.course}» بانتظارك، والاختبار ${COPY.ar.when(p.days)}.`, 'مهمة واحدة اليوم تكفي لاستعادة الإيقاع.'],
          cta: 'افتح خطة المذاكرة',
        },
        exam_passed: {
          subject: () => 'وماذا عن الاختبار القادم؟',
          preheader: 'أضف ملاحظاتك واختر الموعد.',
          lines: () => ['عندما يكون لديك موعد لاختبارك القادم، يبني Exama خطة يومية من ملاحظاتك أنت.'],
          cta: 'خطّط لاختباري القادم',
        },
        course_ready: {
          subject: (p) => `خطة مذاكرة لمقرر «${p.course}»: النسخة المختصرة`,
          preheader: 'موعد الاختبار، والوقت اليومي، ومستوى استعدادك.',
          lines: (p) => [`لمقرر «${p.course}» تحتاج إلى ثلاث إجابات فقط: موعد الاختبار، والوقت المتاح لك يوميًا، ومستوى استعدادك. وExama يتولى التنظيم.`],
          cta: 'أنشئ خطة مذاكرتي',
        },
        no_course: {
          subject: () => 'رفع ملف واحد يكفي لتبدأ',
          preheader: 'ملف PDF أو عرض PowerPoint من مقررك.',
          lines: () => ['أضف ملف PDF أو عرض PowerPoint من مقررك فتحصل على اختبارات مبنية عليه مع ملاحظات على كل إجابة. وإذا أضفت موعد اختبارك فستحصل أيضًا على خطة مذاكرة.'],
          cta: 'أضف أول مقرر لي',
        },
      },
    },
    foot: {
      why: 'تصلك هذه الرسالة لأنك اخترت تلقي النصائح والأخبار والعروض من Exama.',
      stop: 'إلغاء الاشتراك',
      stopTail: '(بنقرة واحدة). رسالة خطة المذاكرة اليومية إعداد منفصل.',
      sentBy: (s) => `أُرسلت من ${s.name}، ${s.address}. للاستفسار: ${s.supportEmail}.`,
    },
  },
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
/** A course title as people read it: no file extension, no stray whitespace, at most `max` characters. */
export function courseLabel(title: string | null | undefined, max = 48): string {
  const t = (title ?? '').replace(/\s+/g, ' ').trim().replace(/\s*\.(pdf|pptx?|docx?)$/i, '').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
const firstName = (name: string) => name.trim().split(/\s+/)[0]?.slice(0, 40) ?? '';

export type EmailInput = {
  to: string;
  name: string;
  language: Lang;
  step: Step;
  variant: Variant;
  course: string | null;
  /** Whole days from the student's local today to the exam (exam_upcoming only). */
  daysUntilExam: number | null;
  /** The button: the click-tracking link (or the app link itself when tracking isn't available). */
  ctaUrl: string;
  unsubscribeUrl: string;
  /** RFC 8058 one-click endpoint (needs the API's public https URL). */
  oneClickUrl: string | null;
  sender: Sender;
  /** Resend tags: campaign key, segment, variant, step. */
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
};

export function buildCampaignEmail(input: EmailInput): Mail {
  const c = COPY[input.language];
  const body = c.steps[input.step][input.variant];
  const p: P = { name: firstName(input.name), course: courseLabel(input.course) || c.fallbackCourse, days: input.daysUntilExam ?? 0 };
  const lines = [c.hello(p.name), ...body.lines(p)];
  const subject = body.subject(p).replace(/\s+/g, ' ').trim();
  const sentBy = c.foot.sentBy(input.sender);

  const text = [...lines.flatMap((l) => [l, '']), `${body.cta}: ${input.ctaUrl}`, '', '—', c.foot.why, `${c.foot.stop} ${c.foot.stopTail} ${input.unsubscribeUrl}`, sentBy].join('\n');

  const dir = input.language === 'ar' ? 'rtl' : 'ltr';
  const html =
    `<div dir="${dir}" lang="${input.language}" style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.55;color:#15173F;max-width:560px">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(body.preheader)}</div>` +
    `<p style="margin:0 0 16px">${escapeHtml(lines[0]!)}</p>` +
    lines
      .slice(1)
      .map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`)
      .join('') +
    `<p style="margin:22px 0"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:#5B4CF5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${escapeHtml(body.cta)}</a></p>` +
    `<p style="font-size:13px;line-height:1.5;color:#646A7E;border-top:1px solid #E3E5EE;padding-top:12px;margin:24px 0 0">${escapeHtml(c.foot.why)} ` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#5B4CF5">${escapeHtml(c.foot.stop)}</a> ${escapeHtml(c.foot.stopTail)}<br>${escapeHtml(sentBy)}</p></div>`;

  // RFC 8058 one-click unsubscribe when the API has a public https URL; the web page otherwise (same as the study reminders).
  const headers: Record<string, string> = input.oneClickUrl
    ? { 'List-Unsubscribe': `<${input.oneClickUrl}>, <${input.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : { 'List-Unsubscribe': `<${input.unsubscribeUrl}>` };
  return { to: input.to, subject, text, html, headers, ...(input.tags && { tags: input.tags }), ...(input.idempotencyKey && { idempotencyKey: input.idempotencyKey }) };
}

/** The preheader of an email (preview text), for the dry-run report. */
export const preheaderOf = (lang: Lang, step: Step, variant: Variant) => COPY[lang].steps[step][variant].preheader;
