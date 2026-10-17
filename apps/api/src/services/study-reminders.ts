/**
 * Daily study-plan reminder emails — the web-first replacement for the app's local notifications.
 *
 * Who gets one (all checked on the server, every run):
 *   - the feature is on (STUDY_REMINDER_EMAILS_ENABLED=true) and email can be sent (EMAIL_PROVIDER and a
 *     web app origin for the links); otherwise the run logs why once and does nothing;
 *   - the account has at least one study plan, a confirmed email address, and reminders switched on
 *     (`users.study_reminder_emails`, off via Account or the unsubscribe link);
 *   - no active subscription: paid plans, the free trial and owner (complimentary) access are excluded,
 *     from the server's entitlement — never from anything the client says;
 *   - its plans have pending tasks on the student's local date (rest days and passed exams: no email).
 *
 * When: from STUDY_REMINDER_LOCAL_HOUR (default 08:00) in the plan's own time zone (stored with the plan
 * from the device; the most recently updated plan's zone when there are several; UTC if none is valid).
 *
 * Content: only stored data — the day's tasks (re-planned deterministically for the new day exactly as
 * opening the plan does, planner/schedule.ts) and the focus notes saved when the plan was made. No AI call.
 *
 * At most one per user and local day: a `study_reminder_emails` row is claimed before sending (primary key
 * user + date), and Resend gets an idempotency key for the same pair, so overlapping runs, retries and
 * restarts can't send twice. A failed send is retried on later runs that day (3 attempts at most).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Entitlement, StudyPlan, TaskActivity } from '@study/shared';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { getEntitlement } from '../billing/entitlements.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { documents, studyPlans, studyReminderEmails, users } from '../db/schema.js';
import { sendMail, type Mail } from '../lib/mailer.js';
import { isValidTimeZone, localDate } from './planner/dates.js';
import { getStudyPlan } from './study-plans.js';

export const MAX_ATTEMPTS = 3;
const PURGE_DAYS = 14;
const RUN_EVERY_MS = 15 * 60_000;
type Lang = 'en' | 'es' | 'fr' | 'ar';
const asLang = (l: string | null | undefined): Lang => (l === 'es' || l === 'fr' || l === 'ar' ? l : 'en');

// ---------------------------------------------------------------- eligibility

/** A paid plan, the free trial or owner access: these students don't get reminder emails. */
export const hasActiveSubscription = (e: Pick<Entitlement, 'isPremium' | 'tier'>) => e.isPremium || e.tier === 'trial';

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

/** The time zone reminders follow: the most recently updated plan's, else UTC. */
export function reminderZone(plans: { timezone: string; updatedAt: Date }[]): string {
  const p = [...plans].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).find((x) => isValidTimeZone(x.timezone));
  return p?.timezone ?? 'UTC';
}

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
  const headers: Record<string, string> = input.oneClickUrl
    ? { 'List-Unsubscribe': `<${input.oneClickUrl}>, <${input.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : { 'List-Unsubscribe': `<${input.unsubscribeUrl}>` };
  return { to: input.to, subject, text, html, headers };
}

// ---------------------------------------------------------------- the daily run

type PlanRow = typeof studyPlans.$inferSelect;
export type RunResult = { sent: number; failed: number; skipped: number; notDue: number; subscribers: number; unavailable?: Exclude<Availability, { ok: true }>['reason'] };

/** Today's work across the student's plans: pending tasks on each plan's local date (exam not passed). */
async function coursesForToday(userId: string, plans: PlanRow[], now: Date): Promise<{ date: string; language: string; courses: ReminderCourse[] }> {
  const titles = new Map(
    (await db.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, plans.map((p) => p.documentId)))).map((d) => [d.id, d.title]),
  );
  const courses: ReminderCourse[] = [];
  let language = 'en';
  for (const p of plans) {
    let plan: StudyPlan;
    try {
      plan = await getStudyPlan(userId, p.documentId, now); // deterministic re-plan for the new day; no AI
    } catch {
      continue; // course deleted meanwhile
    }
    if (plan.daysUntilExam < 0) continue;
    const tasks = plan.tasks.filter((x) => x.date === plan.today && x.status === 'pending');
    if (!tasks.length) continue;
    const topics = [...new Set(tasks.map((x) => x.topic).filter((x): x is string => !!x))];
    const focus = topics
      .map((topic) => ({ topic, text: plan.topics.find((i) => i.topic === topic)?.focus?.trim() ?? '' }))
      .filter((f) => f.text)
      .slice(0, 2);
    if (!courses.length) language = plan.language;
    courses.push({ title: titles.get(p.documentId) ?? '', documentId: p.documentId, daysUntilExam: plan.daysUntilExam, tasks: tasks.map((x) => ({ activity: x.activity, topic: x.topic, minutes: x.minutes })), focus });
  }
  return { date: localDate(now, reminderZone(plans)), language, courses };
}

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
let running = false;

/** One pass over all eligible accounts (`userIds` limits it, for tests). */
export async function runStudyReminders(now = new Date(), opts: { userIds?: string[] } = {}): Promise<RunResult> {
  const result: RunResult = { sent: 0, failed: 0, skipped: 0, notDue: 0, subscribers: 0 };
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
    // Accounts with a plan, a confirmed address and reminders on.
    const rows = await db
      .select({ plan: studyPlans, email: users.email, name: users.name })
      .from(studyPlans)
      .innerJoin(users, eq(users.id, studyPlans.userId))
      .where(and(eq(users.studyReminderEmails, true), isNotNull(users.emailVerifiedAt), ...(opts.userIds ? [inArray(users.id, opts.userIds)] : [])));
    const byUser = new Map<string, { email: string; name: string; plans: PlanRow[] }>();
    for (const r of rows) {
      const u = byUser.get(r.plan.userId) ?? { email: r.email, name: r.name, plans: [] };
      u.plans.push(r.plan);
      byUser.set(r.plan.userId, u);
    }

    for (const [userId, u] of byUser) {
      const zone = reminderZone(u.plans);
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
      try {
        if (hasActiveSubscription(await getEntitlement(userId))) {
          result.subscribers++;
          continue;
        }
        const today = await coursesForToday(userId, u.plans, now);
        if (!(await claim(userId, date))) continue;
        if (!today.courses.length) {
          await mark(userId, date, 'skipped');
          result.skipped++;
          continue;
        }
        const token = unsubscribeToken(userId);
        const mail = buildReminderEmail({
          to: u.email,
          name: u.name,
          language: today.language,
          date: today.date,
          courses: today.courses,
          planUrl: (id) => `${config.WEB_APP_URL}/plan/${id}`,
          unsubscribeUrl: unsubscribePageUrl(token),
          oneClickUrl: oneClickUrl(token),
        });
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
    if (result.sent || result.failed) console.log(`[study-reminders] sent ${result.sent}, failed ${result.failed}, nothing planned ${result.skipped}.`);
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
