/**
 * Daily study reminder emails — re-engagement for free students who have never paid.
 *
 * Who gets one (all checked on the server, every run; anything that can't be established → no email):
 *   - the feature is on (STUDY_REMINDER_EMAILS_ENABLED=true) and email can be sent (EMAIL_PROVIDER and a
 *     web app origin for the links); otherwise the run logs why once and does nothing;
 *   - a confirmed email address and reminders switched on (`users.study_reminder_emails`, off via Account
 *     or the unsubscribe link);
 *   - exactly ONE course (`documents`, counted like the plan limit counts courses); none or several: no email;
 *   - the Free plan and NO billing history at all, from the server's own records (`billingEligibility`):
 *     no `subscriptions` row in any state (that row is the only record of paid plans and trials, from every
 *     store, and is overwritten in place — so a cancelled or expired row can't prove a payment never
 *     happened), no Stripe customer (a started web checkout: payment can't be ruled out locally), no owner
 *     access, and the entitlement says Free. Never anything the client says. Errors → no email.
 *
 * Two emails:
 *   - the course has a study plan → today's pending tasks and stored focus notes (as before). A day with
 *     nothing pending (rest day, all done, exam passed) sends nothing;
 *   - no study plan → a short nudge to come back to the course, with a link to it, and a link to create a
 *     study plan when the student can still create one this month.
 *
 * When: from STUDY_REMINDER_LOCAL_HOUR (default 08:00) local time — the plan's time zone (stored from the
 * device), else the device time zone the app reports with `app_opened`. No known zone → no email (we
 * can't know it's 08:00 there).
 *
 * Language: the app language the app last reported (`app_opened`), else the plan's / course's language.
 *
 * Content: only stored data — no AI call, no offers, prices or upgrade prompts.
 *
 * At most one per user and local day: a `study_reminder_emails` row is claimed before sending (primary key
 * user + date), and Resend gets an idempotency key for the same pair, so overlapping runs, retries and
 * restarts can't send twice. A failed send is retried on later runs that day (3 attempts at most).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { StudyPlan, TaskActivity } from '@study/shared';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { getEntitlement, isOwner } from '../billing/entitlements.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { analyticsEvents, documents, stripeCustomers, studyPlans, studyReminderEmails, subscriptions, users } from '../db/schema.js';
import { sendMail, type Mail } from '../lib/mailer.js';
import { isValidTimeZone, localDate } from './planner/dates.js';
import { getStudyPlan } from './study-plans.js';

export const MAX_ATTEMPTS = 3;
const PURGE_DAYS = 14;
const RUN_EVERY_MS = 15 * 60_000;
type Lang = 'en' | 'es' | 'fr' | 'ar';
const isLang = (l: unknown): l is Lang => l === 'en' || l === 'es' || l === 'fr' || l === 'ar';
const asLang = (l: string | null | undefined): Lang => (isLang(l) ? l : 'en');

// ---------------------------------------------------------------- eligibility

export type BillingEligibility =
  | { ok: true; /** The Free plan still allows creating a study plan this month. */ canCreatePlan: boolean }
  | { ok: false; reason: 'owner' | 'subscription_record' | 'stripe_customer' | 'not_free' | 'unknown' };

/**
 * Free plan and never paid, from the server's billing records only. Fails closed: any record of a
 * subscription or trial (active, cancelled or expired, any store), any Stripe customer, owner access, an
 * entitlement other than plain Free, or an error while checking → not eligible.
 */
export async function billingEligibility(userId: string): Promise<BillingEligibility> {
  try {
    if (await isOwner(userId)) return { ok: false, reason: 'owner' };
    const [[sub], [customer]] = await Promise.all([
      db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1),
      db.select({ id: stripeCustomers.stripeCustomerId }).from(stripeCustomers).where(eq(stripeCustomers.userId, userId)).limit(1),
    ]);
    if (sub) return { ok: false, reason: 'subscription_record' };
    if (customer) return { ok: false, reason: 'stripe_customer' };
    const e = await getEntitlement(userId);
    if (e.tier !== 'free' || e.isPremium || e.status !== 'free' || e.planId !== null) return { ok: false, reason: 'not_free' };
    const plansLeft = e.limits.studyPlansPerMonth === null || e.usage.studyPlansThisMonth < e.limits.studyPlansPerMonth;
    return { ok: true, canCreatePlan: plansLeft };
  } catch {
    return { ok: false, reason: 'unknown' };
  }
}

export type Availability = { ok: true } | { ok: false; reason: 'disabled' | 'email_disabled' | 'no_web_app_url' };
export function remindersAvailable(): Availability {
  if (!config.STUDY_REMINDER_EMAILS_ENABLED) return { ok: false, reason: 'disabled' };
  if (config.EMAIL_PROVIDER === 'disabled') return { ok: false, reason: 'email_disabled' };
  if (!config.WEB_APP_URL) return { ok: false, reason: 'no_web_app_url' };
  return { ok: true };
}
const WHY: Record<Exclude<Availability, { ok: true }>['reason'], string> = {
  disabled: 'off (set STUDY_REMINDER_EMAILS_ENABLED=true to send them)',
  email_disabled: 'not sent: EMAIL_PROVIDER is disabled — set EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM',
  no_web_app_url: 'not sent: no web app origin for the links — set WEB_APP_URL (e.g. https://app.exama.app)',
};

export function localHour(now: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: isValidTimeZone(tz) ? tz : 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(h);
}

// ---------------------------------------------------------------- unsubscribe links

const sign = (userId: string) => createHmac('sha256', config.JWT_SECRET).update(`study-reminders-unsubscribe:${userId}`).digest('base64url').slice(0, 32);
/** `<userId>.<signature>`: lets the link turn reminders off for that account only, without signing in. */
export const unsubscribeToken = (userId: string) => `${userId}.${sign(userId)}`;
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/i.exec(token ?? '');
  if (!m) return null;
  const want = Buffer.from(sign(m[1]!.toLowerCase()));
  const got = Buffer.from(m[2]!);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1]!.toLowerCase() : null;
}
const apiBase = () => {
  const raw = config.API_PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL;
  return raw && URL.canParse(raw) && new URL(raw).protocol === 'https:' ? raw.replace(/\/+$/, '') : null;
};
export const unsubscribePageUrl = (token: string) => `${config.WEB_APP_URL}/unsubscribe#token=${token}`;
export const oneClickUrl = (token: string) => {
  const base = apiBase();
  return base ? `${base}/email/unsubscribe?token=${encodeURIComponent(token)}` : null;
};

/** One-click unsubscribe and the web page: turns reminders off. Unknown (e.g. deleted) accounts: nothing to do. */
export async function unsubscribeWithToken(token: string): Promise<boolean> {
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return false;
  await db.update(users).set({ studyReminderEmails: false }).where(eq(users.id, userId));
  return true;
}

// ---------------------------------------------------------------- email

export type ReminderCourse = {
  title: string;
  documentId: string;
  daysUntilExam: number;
  tasks: { activity: TaskActivity; topic: string | null; minutes: number }[];
  /** Stored focus notes (written when the plan was made) for today's topics. */
  focus: { topic: string; text: string }[];
};

/** Arabic counted days: يوم واحد، يومين، 3–10 أيام، 11+ يومًا. */
const arDays = (d: number) => (d === 1 ? 'يوم واحد' : d === 2 ? 'يومين' : d <= 10 ? `${d} أيام` : `${d} يومًا`);

const T: Record<
  Lang,
  {
    subject: (topic: string) => string;
    subjectSoon: (days: number) => string;
    hello: (name: string) => string;
    intro: (date: string) => string;
    exam: (days: number) => string;
    examToday: string;
    activity: Record<TaskActivity, string>;
    wholeCourse: string;
    minutes: (n: number) => string;
    total: (n: number) => string;
    focus: string;
    cta: string;
    why: string;
    stop: string;
    manage: string;
  }
> = {
  en: {
    subject: (topic) => `Today’s study plan: ${topic}`,
    subjectSoon: (d) => (d === 0 ? 'Exam day — your plan for today' : `Your exam is in ${d} day${d === 1 ? '' : 's'} — today’s plan`),
    hello: (n) => `Hi ${n},`,
    intro: (date) => `Here’s what your study plan has for today, ${date}:`,
    exam: (d) => `exam in ${d} day${d === 1 ? '' : 's'}`,
    examToday: 'exam today',
    activity: { learn: 'Learn', review: 'Review', practice: 'Practice', exam: 'Mock exam', weak_review: 'Review a weak topic' },
    wholeCourse: 'the whole course',
    minutes: (n) => `${n} min`,
    total: (n) => `About ${n} minutes in total.`,
    focus: 'What to focus on',
    cta: 'Open today’s plan',
    why: 'You get this email because you have a study plan in Exama.',
    stop: 'Stop these emails',
    manage: 'or turn them off in Account → Study reminders.',
  },
  es: {
    subject: (topic) => `Tu plan de estudio de hoy: ${topic}`,
    subjectSoon: (d) => (d === 0 ? 'Hoy es el examen: tu plan de hoy' : `Tu examen es en ${d} día${d === 1 ? '' : 's'}: el plan de hoy`),
    hello: (n) => `Hola, ${n}:`,
    intro: (date) => `Esto es lo que tu plan de estudio tiene para hoy, ${date}:`,
    exam: (d) => `examen en ${d} día${d === 1 ? '' : 's'}`,
    examToday: 'examen hoy',
    activity: { learn: 'Aprender', review: 'Repasar', practice: 'Practicar', exam: 'Examen de prueba', weak_review: 'Repasar un tema débil' },
    wholeCourse: 'todo el curso',
    minutes: (n) => `${n} min`,
    total: (n) => `Unos ${n} minutos en total.`,
    focus: 'En qué centrarte',
    cta: 'Abrir el plan de hoy',
    why: 'Recibes este correo porque tienes un plan de estudio en Exama.',
    stop: 'Dejar de recibir estos correos',
    manage: 'o desactívalos en Cuenta → Recordatorios de estudio.',
  },
  fr: {
    subject: (topic) => `Votre plan de révision du jour : ${topic}`,
    subjectSoon: (d) => (d === 0 ? 'Jour d’examen : votre plan du jour' : `Votre examen a lieu dans ${d} jour${d === 1 ? '' : 's'} : le plan du jour`),
    hello: (n) => `Bonjour ${n},`,
    intro: (date) => `Voici ce que prévoit votre plan de révision pour aujourd’hui, ${date} :`,
    exam: (d) => `examen dans ${d} jour${d === 1 ? '' : 's'}`,
    examToday: 'examen aujourd’hui',
    activity: { learn: 'Apprendre', review: 'Réviser', practice: 'S’entraîner', exam: 'Examen blanc', weak_review: 'Retravailler un point faible' },
    wholeCourse: 'tout le cours',
    minutes: (n) => `${n} min`,
    total: (n) => `Environ ${n} minutes au total.`,
    focus: 'Sur quoi vous concentrer',
    cta: 'Ouvrir le plan du jour',
    why: 'Vous recevez cet e-mail parce que vous avez un plan de révision dans Exama.',
    stop: 'Ne plus recevoir ces e-mails',
    manage: 'ou désactivez-les dans Compte → Rappels de révision.',
  },
  ar: {
    subject: (topic) => `خطة مذاكرتك لليوم: ${topic}`,
    subjectSoon: (d) => (d === 0 ? 'يوم الاختبار — خطتك لليوم' : `اختبارك بعد ${arDays(d)} — خطة اليوم`),
    hello: (n) => `مرحبًا ${n}،`,
    intro: (date) => `هذا ما تتضمنه خطة مذاكرتك لليوم، ${date}:`,
    exam: (d) => `الاختبار بعد ${arDays(d)}`,
    examToday: 'الاختبار اليوم',
    activity: { learn: 'تعلّم', review: 'مراجعة', practice: 'تدرّب', exam: 'اختبار تجريبي', weak_review: 'مراجعة موضوع ضعيف' },
    wholeCourse: 'المقرر كاملًا',
    minutes: (n) => `${n} دقيقة`,
    total: (n) => `نحو ${n} دقيقة إجمالًا.`,
    focus: 'ما الذي تركّز عليه',
    cta: 'افتح خطة اليوم',
    why: 'تصلك هذه الرسالة لأن لديك خطة مذاكرة في Exama.',
    stop: 'إيقاف هذه الرسائل',
    manage: 'أو أوقفها من الحساب ← تذكيرات المذاكرة.',
  },
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const formatDay = (date: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : lang, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

export function buildReminderEmail(input: {
  to: string;
  name: string;
  language: string;
  date: string;
  courses: ReminderCourse[];
  planUrl: (documentId: string) => string;
  unsubscribeUrl: string;
  oneClickUrl: string | null;
}): Mail {
  const lang = asLang(input.language);
  const t = T[lang];
  const courses = [...input.courses].sort((a, b) => a.daysUntilExam - b.daysUntilExam);
  const first = courses[0]!;
  const firstTopic = first.tasks[0]?.topic ?? first.title;
  const subject = first.daysUntilExam <= 3 ? t.subjectSoon(first.daysUntilExam) : t.subject(firstTopic);
  const total = courses.reduce((n, c) => n + c.tasks.reduce((s, x) => s + x.minutes, 0), 0);
  const name = input.name.trim().split(/\s+/)[0] || input.name;
  const examLabel = (c: ReminderCourse) => (c.daysUntilExam === 0 ? t.examToday : t.exam(c.daysUntilExam));
  const line = (x: ReminderCourse['tasks'][number]) => `${t.activity[x.activity]}: ${x.topic ?? t.wholeCourse} (${t.minutes(x.minutes)})`;

  const text = [
    t.hello(name),
    '',
    t.intro(formatDay(input.date, lang)),
    '',
    ...courses.flatMap((c) => [
      `${c.title} — ${examLabel(c)}`,
      ...c.tasks.map((x) => `• ${line(x)}`),
      ...(c.focus.length ? [`${t.focus}:`, ...c.focus.map((f) => `  ${f.topic}: ${f.text}`)] : []),
      `${t.cta}: ${input.planUrl(c.documentId)}`,
      '',
    ]),
    t.total(total),
    '',
    '—',
    t.why,
    `${t.stop}: ${input.unsubscribeUrl}`,
    t.manage,
  ].join('\n');

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const html =
    `<div dir="${dir}" lang="${lang}" style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#15173F;max-width:560px">` +
    `<p>${escapeHtml(t.hello(name))}</p><p>${escapeHtml(t.intro(formatDay(input.date, lang)))}</p>` +
    courses
      .map(
        (c) =>
          `<div style="border:1px solid #E3E5EE;border-radius:12px;padding:14px 16px;margin:12px 0">` +
          `<p style="margin:0 0 6px"><strong>${escapeHtml(c.title)}</strong> <span style="color:#646A7E">· ${escapeHtml(examLabel(c))}</span></p>` +
          `<ul style="margin:0 0 8px;padding-inline-start:20px">${c.tasks.map((x) => `<li>${escapeHtml(line(x))}</li>`).join('')}</ul>` +
          (c.focus.length
            ? `<p style="margin:8px 0 4px;font-size:14px;color:#646A7E">${escapeHtml(t.focus)}</p>` +
              c.focus.map((f) => `<p style="margin:0 0 6px;font-size:14px"><strong>${escapeHtml(f.topic)}:</strong> ${escapeHtml(f.text)}</p>`).join('')
            : '') +
          `<p style="margin:10px 0 0"><a href="${escapeHtml(input.planUrl(c.documentId))}" style="display:inline-block;background:#5B4CF5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">${escapeHtml(t.cta)}</a></p>` +
          `</div>`,
      )
      .join('') +
    `<p>${escapeHtml(t.total(total))}</p>` +
    `<p style="font-size:13px;color:#646A7E;border-top:1px solid #E3E5EE;padding-top:12px">${escapeHtml(t.why)} ` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#5B4CF5">${escapeHtml(t.stop)}</a> ${escapeHtml(t.manage)}</p></div>`;

  // RFC 8058 one-click unsubscribe when the API has a public https URL; the web page otherwise.
  return { to: input.to, subject, text, html, headers: unsubscribeHeaders(input.unsubscribeUrl, input.oneClickUrl) };
}

/** The "no study plan yet" email: come back to the course; create a plan when one can still be made. */
const R: Record<
  Lang,
  {
    subject: (course: string) => string;
    hello: (name: string) => string;
    intro: (course: string) => string;
    keepGoing: string;
    cta: string;
    planTip: string;
    planCta: string;
    why: string;
    stop: string;
    manage: string;
  }
> = {
  en: {
    subject: (c) => `Pick up where you left off: ${c}`,
    hello: (n) => `Hi ${n},`,
    intro: (c) => `Your course “${c}” is waiting for you in Exama.`,
    keepGoing: 'A short study session today helps you keep what you’ve learned fresh.',
    cta: 'Continue studying',
    planTip: 'Have an exam coming up? A study plan spreads your topics over the days you have left and tells you what to do each day.',
    planCta: 'Create a study plan',
    why: 'You get this email because you have a course in Exama.',
    stop: 'Stop these emails',
    manage: 'or turn them off in Account → Study reminders.',
  },
  es: {
    subject: (c) => `Retoma donde lo dejaste: ${c}`,
    hello: (n) => `Hola, ${n}:`,
    intro: (c) => `Tu curso «${c}» te espera en Exama.`,
    keepGoing: 'Una sesión de estudio corta hoy te ayuda a mantener fresco lo que has aprendido.',
    cta: 'Seguir estudiando',
    planTip: '¿Tienes un examen pronto? Un plan de estudio reparte tus temas en los días que te quedan y te dice qué hacer cada día.',
    planCta: 'Crear un plan de estudio',
    why: 'Recibes este correo porque tienes un curso en Exama.',
    stop: 'Dejar de recibir estos correos',
    manage: 'o desactívalos en Cuenta → Recordatorios de estudio.',
  },
  fr: {
    subject: (c) => `Reprenez là où vous en étiez : ${c}`,
    hello: (n) => `Bonjour ${n},`,
    intro: (c) => `Votre cours « ${c} » vous attend dans Exama.`,
    keepGoing: 'Une courte séance de révision aujourd’hui vous aide à garder en tête ce que vous avez appris.',
    cta: 'Continuer à réviser',
    planTip: 'Un examen approche ? Un plan de révision répartit vos thèmes sur les jours qui restent et vous dit quoi faire chaque jour.',
    planCta: 'Créer un plan de révision',
    why: 'Vous recevez cet e-mail parce que vous avez un cours dans Exama.',
    stop: 'Ne plus recevoir ces e-mails',
    manage: 'ou désactivez-les dans Compte → Rappels de révision.',
  },
  ar: {
    subject: (c) => `تابع من حيث توقفت: ${c}`,
    hello: (n) => `مرحبًا ${n}،`,
    intro: (c) => `مقررك «${c}» بانتظارك في Exama.`,
    keepGoing: 'جلسة مذاكرة قصيرة اليوم تساعدك على تثبيت ما تعلّمته.',
    cta: 'تابع المذاكرة',
    planTip: 'هل لديك اختبار قريب؟ خطة المذاكرة توزّع موضوعاتك على الأيام المتبقية وتخبرك بما تفعله كل يوم.',
    planCta: 'أنشئ خطة مذاكرة',
    why: 'تصلك هذه الرسالة لأن لديك مقررًا في Exama.',
    stop: 'إيقاف هذه الرسائل',
    manage: 'أو أوقفها من الحساب ← تذكيرات المذاكرة.',
  },
};

const unsubscribeHeaders = (unsubscribeUrl: string, oneClick: string | null): Record<string, string> =>
  oneClick
    ? { 'List-Unsubscribe': `<${oneClick}>, <${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : { 'List-Unsubscribe': `<${unsubscribeUrl}>` };

export function buildReturnEmail(input: {
  to: string;
  name: string;
  language: string;
  course: { title: string; documentId: string };
  courseUrl: string;
  /** Only when the student can still create a study plan. */
  createPlanUrl: string | null;
  unsubscribeUrl: string;
  oneClickUrl: string | null;
}): Mail {
  const lang = asLang(input.language);
  const t = R[lang];
  const name = input.name.trim().split(/\s+/)[0] || input.name;
  const title = input.course.title.trim() || 'Exama';
  const text = [
    t.hello(name),
    '',
    t.intro(title),
    t.keepGoing,
    '',
    `${t.cta}: ${input.courseUrl}`,
    ...(input.createPlanUrl ? ['', t.planTip, `${t.planCta}: ${input.createPlanUrl}`] : []),
    '',
    '—',
    t.why,
    `${t.stop}: ${input.unsubscribeUrl}`,
    t.manage,
  ].join('\n');
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const html =
    `<div dir="${dir}" lang="${lang}" style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#15173F;max-width:560px">` +
    `<p>${escapeHtml(t.hello(name))}</p><p>${escapeHtml(t.intro(title))}</p><p>${escapeHtml(t.keepGoing)}</p>` +
    `<p style="margin:16px 0"><a href="${escapeHtml(input.courseUrl)}" style="display:inline-block;background:#5B4CF5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">${escapeHtml(t.cta)}</a></p>` +
    (input.createPlanUrl
      ? `<p>${escapeHtml(t.planTip)} <a href="${escapeHtml(input.createPlanUrl)}" style="color:#5B4CF5;font-weight:600">${escapeHtml(t.planCta)}</a></p>`
      : '') +
    `<p style="font-size:13px;color:#646A7E;border-top:1px solid #E3E5EE;padding-top:12px">${escapeHtml(t.why)} ` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#5B4CF5">${escapeHtml(t.stop)}</a> ${escapeHtml(t.manage)}</p></div>`;
  return { to: input.to, subject: t.subject(title), text, html, headers: unsubscribeHeaders(input.unsubscribeUrl, input.oneClickUrl) };
}

// ---------------------------------------------------------------- the daily run

type PlanRow = typeof studyPlans.$inferSelect;
export type RunResult = {
  sent: number;
  failed: number;
  /** Nothing to send today (plan with nothing pending, course not ready). */
  skipped: number;
  notDue: number;
  /** Excluded by billing: any subscription/trial record, a Stripe customer, owner access, or not plain Free. */
  subscribers: number;
  /** No known local time zone (no plan, and the app hasn't reported one): never sent. */
  noTimeZone: number;
  unavailable?: Exclude<Availability, { ok: true }>['reason'];
};

/** Today's pending tasks of the plan on its local date (exam not passed). Null: nothing to send today. */
async function planForToday(userId: string, p: PlanRow, title: string, now: Date): Promise<{ language: string; course: ReminderCourse } | null> {
  let plan: StudyPlan;
  try {
    plan = await getStudyPlan(userId, p.documentId, now); // deterministic re-plan for the new day; no AI
  } catch {
    return null; // course deleted meanwhile
  }
  if (plan.daysUntilExam < 0) return null;
  const tasks = plan.tasks.filter((x) => x.date === plan.today && x.status === 'pending');
  if (!tasks.length) return null;
  const topics = [...new Set(tasks.map((x) => x.topic).filter((x): x is string => !!x))];
  const focus = topics
    .map((topic) => ({ topic, text: plan.topics.find((i) => i.topic === topic)?.focus?.trim() ?? '' }))
    .filter((f) => f.text)
    .slice(0, 2);
  return {
    language: plan.language,
    course: { title, documentId: p.documentId, daysUntilExam: plan.daysUntilExam, tasks: tasks.map((x) => ({ activity: x.activity, topic: x.topic, minutes: x.minutes })), focus },
  };
}

/**
 * What the app last reported about the device (`app_opened`): its app language and time zone. Only these two
 * fields are read; invalid values are ignored.
 *
 * 1. The account's own signed-in `app_opened` events.
 * 2. Otherwise, signed-out `app_opened` events of an install this account has used: the anonymous id the app
 *    keeps per install and sends with every event, taken from this account's own signed-in client events.
 *    The app sends `app_opened` once at launch (and on return from the background), so a student who opens the
 *    app signed out and signs up in that same session has only a signed-out one — the cause of no reminders
 *    being sent on 2026-10-18. Events of other accounts are never used.
 */
export async function deviceSignals(userId: string): Promise<{ language: Lang | null; timeZone: string | null }> {
  let language: Lang | null = null;
  let timeZone: string | null = null;
  const take = (events: { properties: Record<string, unknown> }[]) => {
    for (const { properties: e } of events) {
      if (!language && isLang(e.app_language)) language = e.app_language;
      if (!timeZone && typeof e.time_zone === 'string' && isValidTimeZone(e.time_zone)) timeZone = e.time_zone;
      if (language && timeZone) return;
    }
  };
  const opened = and(eq(analyticsEvents.name, 'app_opened'), eq(analyticsEvents.source, 'client'));
  take(
    await db
      .select({ properties: analyticsEvents.properties })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.userId, userId), opened))
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(20),
  );
  if (language && timeZone) return { language, timeZone };

  const installs = await db
    .selectDistinct({ id: analyticsEvents.anonymousId })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.source, 'client'), isNotNull(analyticsEvents.anonymousId)))
    .limit(20);
  const ids = installs.map((i) => i.id).filter((id): id is string => !!id);
  if (ids.length) {
    take(
      await db
        .select({ properties: analyticsEvents.properties })
        .from(analyticsEvents)
        .where(and(opened, inArray(analyticsEvents.anonymousId, ids), isNull(analyticsEvents.userId), sql`${analyticsEvents.properties}->>'authenticated' = 'false'`))
        .orderBy(desc(analyticsEvents.createdAt))
        .limit(20),
    );
  }
  return { language, timeZone };
}

/** Absolute link into the web app (WEB_APP_URL is validated as an absolute origin, https in production). */
const appLink = (path: string, params?: Record<string, string>) => {
  const u = new URL(path, `${config.WEB_APP_URL!.replace(/\/+$/, '')}/`);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  return u.toString();
};

/** Claims (user, date) for sending. False when another run already did, or the day is done. */
async function claim(userId: string, date: string): Promise<boolean> {
  const fresh = await db.insert(studyReminderEmails).values({ userId, localDate: date }).onConflictDoNothing().returning({ u: studyReminderEmails.userId });
  if (fresh.length) return true;
  const retry = await db
    .update(studyReminderEmails)
    .set({ status: 'claimed', attempts: sql`${studyReminderEmails.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(studyReminderEmails.userId, userId), eq(studyReminderEmails.localDate, date), eq(studyReminderEmails.status, 'failed'), lt(studyReminderEmails.attempts, MAX_ATTEMPTS)))
    .returning({ u: studyReminderEmails.userId });
  return retry.length > 0;
}
const mark = (userId: string, date: string, status: 'sent' | 'failed' | 'skipped') =>
  db.update(studyReminderEmails).set({ status, updatedAt: new Date() }).where(and(eq(studyReminderEmails.userId, userId), eq(studyReminderEmails.localDate, date)));

let lastUnavailable: string | null = null;
let lastSummary: string | null = null;
let running = false;

/** One pass over all eligible accounts (`userIds` limits it, for tests). */
export async function runStudyReminders(now = new Date(), opts: { userIds?: string[] } = {}): Promise<RunResult> {
  const result: RunResult = { sent: 0, failed: 0, skipped: 0, notDue: 0, subscribers: 0, noTimeZone: 0 };
  const available = remindersAvailable();
  if (!available.ok) {
    if (lastUnavailable !== available.reason) console[available.reason === 'disabled' ? 'log' : 'error'](`[study-reminders] Daily study-plan emails are ${WHY[available.reason]}.`);
    lastUnavailable = available.reason;
    return { ...result, unavailable: available.reason };
  }
  lastUnavailable = null;
  if (running) return result;
  running = true;
  try {
    // Accounts with a confirmed address, reminders on and exactly one course (all of the user's documents
    // count, like the plan's course limit).
    const courseCounts = db.select({ userId: documents.userId, n: count().as('n') }).from(documents).groupBy(documents.userId).as('course_counts');
    const rows = await db
      .select({ userId: users.id, email: users.email, name: users.name, doc: { id: documents.id, title: documents.title, status: documents.status, aiLanguage: documents.aiLanguage, summaryLanguage: documents.summaryLanguage }, plan: studyPlans })
      .from(users)
      .innerJoin(courseCounts, and(eq(courseCounts.userId, users.id), eq(courseCounts.n, 1)))
      .innerJoin(documents, eq(documents.userId, users.id))
      .leftJoin(studyPlans, eq(studyPlans.documentId, documents.id))
      .where(and(eq(users.studyReminderEmails, true), isNotNull(users.emailVerifiedAt), ...(opts.userIds ? [inArray(users.id, opts.userIds)] : [])));

    for (const u of rows) {
      const { userId } = u;
      try {
        const device = await deviceSignals(userId);
        // The plan's zone (its "today" is computed there), else the device's; unknown → never sent.
        const zone = u.plan && isValidTimeZone(u.plan.timezone) ? u.plan.timezone : device.timeZone;
        if (!zone) {
          result.noTimeZone++;
          continue;
        }
        const date = localDate(now, zone);
        if (localHour(now, zone) < config.STUDY_REMINDER_LOCAL_HOUR) {
          result.notDue++;
          continue;
        }
        const [done] = await db
          .select({ status: studyReminderEmails.status, attempts: studyReminderEmails.attempts })
          .from(studyReminderEmails)
          .where(and(eq(studyReminderEmails.userId, userId), eq(studyReminderEmails.localDate, date)));
        if (done && (done.status !== 'failed' || done.attempts >= MAX_ATTEMPTS)) continue;

        const billing = await billingEligibility(userId);
        if (!billing.ok) {
          result.subscribers++;
          continue;
        }

        const token = unsubscribeToken(userId);
        const courseLanguage = u.doc.aiLanguage !== 'source' ? u.doc.aiLanguage : u.doc.summaryLanguage;
        let mail: Mail | null = null;
        if (u.plan) {
          const today = await planForToday(userId, u.plan, u.doc.title, now);
          if (today)
            mail = buildReminderEmail({
              to: u.email,
              name: u.name,
              language: device.language ?? today.language,
              date,
              courses: [today.course],
              planUrl: (id) => appLink(`plan/${id}`),
              unsubscribeUrl: unsubscribePageUrl(token),
              oneClickUrl: oneClickUrl(token),
            });
        } else if (u.doc.status === 'ready') {
          mail = buildReturnEmail({
            to: u.email,
            name: u.name,
            language: device.language ?? courseLanguage ?? 'en',
            course: { title: u.doc.title, documentId: u.doc.id },
            courseUrl: appLink(`documents/${u.doc.id}`),
            createPlanUrl: billing.canCreatePlan ? appLink('plan/setup', { id: u.doc.id }) : null,
            unsubscribeUrl: unsubscribePageUrl(token),
            oneClickUrl: oneClickUrl(token),
          });
        }

        if (!(await claim(userId, date))) continue;
        if (!mail) {
          await mark(userId, date, 'skipped');
          result.skipped++;
          continue;
        }
        try {
          await sendMail({ ...mail, idempotencyKey: `study-reminder/${userId}/${date}` });
          await mark(userId, date, 'sent');
          result.sent++;
        } catch (err) {
          await mark(userId, date, 'failed');
          result.failed++;
          console.error(`[study-reminders] email for ${date} could not be sent (will retry): ${err instanceof Error ? err.message : 'unknown error'}`);
        }
      } catch (err) {
        console.error('[study-reminders] skipped one account after an error:', err instanceof Error ? err.message : err);
      }
    }
    if (result.sent || result.failed) console.log(`[study-reminders] sent ${result.sent}, failed ${result.failed}, nothing to send ${result.skipped}.`);
    // Why nobody got an email is otherwise invisible: log the counts whenever they change (not every 15 minutes).
    const summary = `${rows.length} account(s) with a confirmed address, reminders on and one course: sent ${result.sent}, failed ${result.failed}, nothing to send ${result.skipped}, before the local send hour ${result.notDue}, no known time zone ${result.noTimeZone}, not eligible (billing) ${result.subscribers}`;
    if (!opts.userIds && summary !== lastSummary) console.log(`[study-reminders] run: ${summary}.`);
    if (!opts.userIds) lastSummary = summary;
    await db.delete(studyReminderEmails).where(lt(studyReminderEmails.updatedAt, new Date(now.getTime() - PURGE_DAYS * 86_400_000)));
    return result;
  } finally {
    running = false;
  }
}

/** Every 15 minutes in the API process (like the media purge); never crashes the server. */
export function startStudyReminders() {
  const run = () => runStudyReminders().catch((err) => console.error('[study-reminders] run failed', err));
  void run();
  setInterval(run, RUN_EVERY_MS).unref();
}
