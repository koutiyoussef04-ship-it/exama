/**
 * Reactivation campaign: bring back accounts that never became subscribers, in two audiences.
 *   has_plan  the account already has a study plan        → "come back to your plan"
 *   no_plan   no study plan (with or without a course)    → "create your first study plan"
 *
 * Run by an operator (scripts/reactivation-campaign.ts) — never by the server, so deploying changes nothing.
 * It reuses the study-reminder system's account rules, billing check, signed unsubscribe links and Resend mailer.
 *
 * Who is emailed (every rule is checked from the database, on every run; anything unclear → no email):
 *   - EXPLICIT MARKETING CONSENT (`users.marketing_consent_at`, set only by ticking the box at sign-up or turning the switch on in
 *     Account — services/marketing-consent.ts). Accounts that never said yes, accounts that existed before consent was asked,
 *     accounts that withdrew, and everyone who merely confirmed their address are out. Checked again just before each email;
 *   - a confirmed address, with study emails still on (`users.study_reminder_emails`; the unsubscribe link of
 *     every email, one click, switches it off), not on the suppression list (hard bounces and spam complaints,
 *     or added by an operator);
 *   - an adult age group (18+): minors and accounts that never gave an age group are left out;
 *   - Free and never paid, from the server's own billing records (`billingEligibility`, fail closed): owners, anyone with
 *     access now (paid or trial), a started Stripe checkout and unreadable billing state are out. Former
 *     subscribers (expired or cancelled) are held out too unless the operator includes them;
 *   - not brand new (3 days) and not active lately (no app opening in `inactiveDays`);
 *   - no other Exama email (daily reminder, other campaign) in the last 7 days.
 * Step 2 (once, 5+ days after step 1) goes only to people who did not return, click, or make a plan since.
 *
 * Never twice: a row (campaign, step, user) is claimed before the send (unique), Resend gets an idempotency key for
 * the same triple, and the audience is checked again just before each email. A failed send is retried by a later run
 * (3 attempts). A send that crashes between claim and result stays "claimed" and is never repeated automatically.
 *
 * Controlled sending: dry run by default; a send needs REACTIVATION_CAMPAIGN_SEND=true, the sender identity, an
 * approval code that depends on the exact next batch and the wording version, a per-run limit, a per-day cap (the
 * Resend free plan allows 100 emails a day for everything, including password-reset and verification emails),
 * small batches with pauses, and it stops at the first sign of trouble (quota, domain or three failures in a row).
 */
import { createHash } from 'node:crypto';
import { and, eq, lt, sql as dsql } from 'drizzle-orm';
import { getEntitlement, isOwner } from '../billing/entitlements.js';
import { config } from '../config.js';
import { db, sql as pg } from '../db/client.js';
import { emailCampaignClicks, emailCampaignSends, emailSuppressions } from '../db/schema.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { sendMail } from '../lib/mailer.js';
import { diffDays, isValidTimeZone, localDate } from './planner/dates.js';
import { marketingUnsubscribeLinks } from './marketing-consent.js';
import { billingEligibility, localHour, oneClickUrl } from './study-reminders.js';
import { TEMPLATES_VERSION, buildCampaignEmail, type Lang, type Segment, type Sender, type Step, type Variant } from './reactivation-emails.js';

export const CAMPAIGN = 'reactivation-2026-10';
export const MAX_ATTEMPTS = 3;
export const STEP2_AFTER_DAYS = 5;
export const MIN_ACCOUNT_AGE_DAYS = 3;
export const DEFAULT_INACTIVE_DAYS = 7;
/** No campaign email within this many days of another Exama email (daily reminder, another campaign). */
export const FREQUENCY_CAP_DAYS = 7;
const ADULT_AGE_RANGES = new Set(['18_24', '25_34', '35_plus']);
/** Resend free plan, shared with password-reset, verification and confirmation emails. */
export const RESEND_DAILY_LIMIT = 100;
export const DEFAULT_MAX_PER_DAY = 60;
/** Students read mail after classes: local 17:00–21:00; accounts with no known time zone get 15:00–19:00 UTC (Europe, evening). */
const LOCAL_WINDOW = { from: 17, to: 21 };
const UNKNOWN_ZONE_UTC_WINDOW = { from: 15, to: 19 };
const DAY_MS = 86_400_000;

export type ExcludeReason =
  | 'not_verified'
  | 'no_marketing_consent'
  | 'opted_out'
  | 'suppressed'
  | 'minor_or_unknown_age'
  | 'already_sent'
  | 'step1_missing'
  | 'too_soon_for_step2'
  | 'returned_after_step1'
  | 'clicked_after_step1'
  | 'converted_after_step1'
  | 'too_new'
  | 'recently_active'
  | 'recently_emailed'
  | 'owner'
  | 'current_subscriber'
  | 'checkout_started'
  | 'billing_unknown'
  | 'lapsed_subscriber'
  | 'exam_today'
  | 'plan_limit_reached';

export type Candidate = {
  userId: string;
  email: string;
  name: string;
  segment: Segment;
  variant: Variant;
  language: Lang;
  timeZone: string | null;
  course: string | null;
  daysUntilExam: number | null;
  /** Path (and query) in the web app the button leads to. */
  target: string;
  /** Inside the send window now (local evening); the rest wait for a later run. */
  dueNow: boolean;
};

export type Audience = {
  step: Step;
  now: Date;
  usersTotal: number;
  eligible: Candidate[];
  excluded: Partial<Record<ExcludeReason, number>>;
};

const isLang = (l: unknown): l is Lang => l === 'en' || l === 'es' || l === 'fr' || l === 'ar';
const validZone = (z: string | null | undefined) => (z && isValidTimeZone(z) ? z : null);
const bucket = (userId: string) => createHash('sha256').update(`${CAMPAIGN}:${userId}`).digest('hex');

export function inSendWindow(now: Date, timeZone: string | null): boolean {
  if (timeZone) {
    const h = localHour(now, timeZone);
    return h >= LOCAL_WINDOW.from && h < LOCAL_WINDOW.to;
  }
  const h = now.getUTCHours();
  return h >= UNKNOWN_ZONE_UTC_WINDOW.from && h < UNKNOWN_ZONE_UTC_WINDOW.to;
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  /** Epoch milliseconds: the database driver here returns timestamps as text, so times are compared as numbers. */
  created_ms: number;
  age_range: string | null;
  reminders_on: boolean;
  verified: boolean;
  consented: boolean;
  last_open_ms: number | null;
  suppressed: boolean;
  last_other_ms: number | null;
  has_sub: boolean;
  has_customer: boolean;
};

/** Everyone, classified: eligible candidates and, for the rest, the first rule that excludes them. */
export async function selectAudience(opts: { step: Step; now?: Date; inactiveDays?: number; includeLapsed?: boolean; anyTime?: boolean; userIds?: string[] }): Promise<Audience> {
  const now = opts.now ?? new Date();
  const inactiveDays = opts.inactiveDays ?? DEFAULT_INACTIVE_DAYS;
  const only = opts.userIds ?? null;
  const users = await pg<UserRow[]>`
    select u.id, u.email, u.name, (extract(epoch from u.created_at) * 1000)::float8 as created_ms, u.age_range, u.study_reminder_emails as reminders_on,
      (u.email_verified_at is not null) as verified,
      (u.marketing_consent_at is not null) as consented,
      (select extract(epoch from max(e.created_at)) * 1000 from analytics_events e where e.user_id = u.id and e.name = 'app_opened' and e.source = 'client')::float8 as last_open_ms,
      exists (select 1 from email_suppressions s where s.email = lower(u.email)) as suppressed,
      (extract(epoch from greatest(
        (select max(r.updated_at) from study_reminder_emails r where r.user_id = u.id and r.status = 'sent'),
        (select max(c.sent_at) from email_campaign_sends c where c.user_id = u.id and c.status = 'sent' and c.campaign <> ${CAMPAIGN})
      )) * 1000)::float8 as last_other_ms,
      exists (select 1 from subscriptions s where s.user_id = u.id) as has_sub,
      exists (select 1 from stripe_customers c where c.user_id = u.id) as has_customer
    from users u
    where (${only}::uuid[] is null or u.id = any(${only}::uuid[]))
    order by u.created_at`;
  const excluded: Audience['excluded'] = {};
  const out = (r: ExcludeReason) => void (excluded[r] = (excluded[r] ?? 0) + 1);
  if (!users.length) return { step: opts.step, now, usersTotal: 0, eligible: [], excluded };

  const ids = users.map((u) => u.id);
  const [plans, docs, langs, zones, sends, clickers] = await Promise.all([
    pg<{ user_id: string; document_id: string; exam_date: string; timezone: string; created_ms: number; title: string; language: string }[]>`
      select sp.user_id, sp.document_id, sp.exam_date, sp.timezone, (extract(epoch from sp.created_at) * 1000)::float8 as created_ms, sp.language, d.title
      from study_plans sp join documents d on d.id = sp.document_id where sp.user_id = any(${ids}::uuid[])`,
    pg<{ id: string; user_id: string; title: string; ai_language: string; summary_language: string | null; source_language: string | null }[]>`
      select id, user_id, title, ai_language, summary_language, source_language from documents
      where status = 'ready' and user_id = any(${ids}::uuid[]) order by created_at desc`,
    pg<{ user_id: string; v: string }[]>`
      select distinct on (user_id) user_id, properties->>'app_language' as v from analytics_events
      where name = 'app_opened' and source = 'client' and user_id = any(${ids}::uuid[]) and properties->>'app_language' is not null
      order by user_id, created_at desc`,
    pg<{ user_id: string; v: string }[]>`
      select distinct on (user_id) user_id, properties->>'time_zone' as v from analytics_events
      where name = 'app_opened' and source = 'client' and user_id = any(${ids}::uuid[]) and properties->>'time_zone' is not null
      order by user_id, created_at desc`,
    pg<{ user_id: string; step: number; status: string; attempts: number; sent_ms: number | null }[]>`
      select user_id, step, status, attempts, (extract(epoch from sent_at) * 1000)::float8 as sent_ms from email_campaign_sends where campaign = ${CAMPAIGN} and user_id = any(${ids}::uuid[])`,
    pg<{ user_id: string }[]>`
      select distinct s.user_id from email_campaign_clicks k join email_campaign_sends s on s.id = k.send_id
      where s.campaign = ${CAMPAIGN} and k.suspected_bot = false and s.user_id = any(${ids}::uuid[])`,
  ]);
  const by = <T extends { user_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
    return m;
  };
  const plansBy = by(plans);
  const docsBy = by(docs);
  const sendsBy = by(sends);
  const langBy = new Map(langs.map((r) => [r.user_id, r.v]));
  const zoneBy = new Map(zones.map((r) => [r.user_id, r.v]));
  const clicked = new Set(clickers.map((r) => r.user_id));

  const eligible: Candidate[] = [];
  for (const u of users) {
    if (!u.verified) { out('not_verified'); continue; }
    // Verified is not consent. Only an explicit yes (sign-up box or the Account switch) counts; a withdrawal clears it.
    if (!u.consented) { out('no_marketing_consent'); continue; }
    if (!u.reminders_on) { out('opted_out'); continue; }
    if (u.suppressed) { out('suppressed'); continue; }
    if (!u.age_range || !ADULT_AGE_RANGES.has(u.age_range)) { out('minor_or_unknown_age'); continue; }

    const mine = sendsBy.get(u.id) ?? [];
    const thisStep = mine.find((s) => s.step === opts.step);
    if (thisStep && (thisStep.status !== 'failed' || thisStep.attempts >= MAX_ATTEMPTS)) { out('already_sent'); continue; }
    const lastOpen = u.last_open_ms;
    if (opts.step === 2) {
      const sentAt = mine.find((s) => s.step === 1 && s.status === 'sent')?.sent_ms;
      if (!sentAt) { out('step1_missing'); continue; }
      if (now.getTime() - sentAt < STEP2_AFTER_DAYS * DAY_MS) { out('too_soon_for_step2'); continue; }
      if (lastOpen !== null && lastOpen > sentAt) { out('returned_after_step1'); continue; }
      if (clicked.has(u.id)) { out('clicked_after_step1'); continue; }
      if ((plansBy.get(u.id) ?? []).some((p) => p.created_ms > sentAt)) { out('converted_after_step1'); continue; }
    }
    if (now.getTime() - u.created_ms < MIN_ACCOUNT_AGE_DAYS * DAY_MS) { out('too_new'); continue; }
    if (opts.step === 1 && now.getTime() - Math.max(u.created_ms, lastOpen ?? 0) < inactiveDays * DAY_MS) { out('recently_active'); continue; }
    if (u.last_other_ms !== null && now.getTime() - u.last_other_ms < FREQUENCY_CAP_DAYS * DAY_MS) { out('recently_emailed'); continue; }

    // Billing, from the server's records only. Fail closed.
    if (await isOwner(u.id)) { out('owner'); continue; }
    let canCreatePlan = false;
    if (u.has_sub || u.has_customer) {
      let e: Awaited<ReturnType<typeof getEntitlement>>;
      try {
        e = await getEntitlement(u.id);
      } catch {
        out('billing_unknown');
        continue;
      }
      // Any access right now (paid, store or web trial, cancelled but not yet ended, owner) — not only the paid tiers.
      if (e.isPremium || (e.status !== 'free' && e.status !== 'expired')) { out('current_subscriber'); continue; }
      if (!u.has_sub) { out('checkout_started'); continue; }
      if (!opts.includeLapsed) { out('lapsed_subscriber'); continue; }
      canCreatePlan = e.limits.studyPlansPerMonth === null || e.usage.studyPlansThisMonth < e.limits.studyPlansPerMonth;
    } else {
      const b = await billingEligibility(u.id);
      if (!b.ok) { out(b.reason === 'owner' ? 'owner' : 'billing_unknown'); continue; }
      canCreatePlan = b.canCreatePlan;
    }

    // Segment and version.
    const myPlans = plansBy.get(u.id) ?? [];
    const myDocs = docsBy.get(u.id) ?? [];
    let segment: Segment;
    let variant: Variant;
    let course: string | null = null;
    let daysUntilExam: number | null = null;
    let target = '/';
    let planLang: string | null = null;
    let planZone: string | null = null;
    if (myPlans.length) {
      segment = 'has_plan';
      const dated = myPlans.map((p) => ({ p, days: diffDays(localDate(now, validZone(p.timezone) ?? 'UTC'), p.exam_date) }));
      const upcoming = dated.filter((x) => x.days >= 0).sort((a, b) => a.days - b.days);
      const pick = upcoming[0] ?? dated.sort((a, b) => b.p.exam_date.localeCompare(a.p.exam_date))[0]!;
      if (pick.days === 0) { out('exam_today'); continue; }
      variant = pick.days > 0 ? 'exam_upcoming' : 'exam_passed';
      course = pick.p.title;
      daysUntilExam = pick.days > 0 ? pick.days : null;
      target = variant === 'exam_upcoming' ? `/plan/${pick.p.document_id}` : '/';
      planLang = pick.p.language;
      planZone = validZone(pick.p.timezone);
    } else {
      segment = 'no_plan';
      const doc = myDocs[0];
      if (doc) {
        if (!canCreatePlan) { out('plan_limit_reached'); continue; }
        variant = 'course_ready';
        course = doc.title;
        target = `/plan/setup?id=${doc.id}`;
        planLang = doc.ai_language !== 'source' ? doc.ai_language : (doc.summary_language ?? doc.source_language);
      } else {
        variant = 'no_course';
      }
    }
    const language: Lang = [langBy.get(u.id), planLang].find(isLang) ?? 'en';
    const timeZone = planZone ?? validZone(zoneBy.get(u.id));
    eligible.push({ userId: u.id, email: u.email, name: u.name, segment, variant, language, timeZone, course, daysUntilExam, target, dueNow: !!opts.anyTime || inSendWindow(now, timeZone) });
  }
  return { step: opts.step, now, usersTotal: users.length, eligible, excluded };
}

/** The next `n` emails to send: those due now, spread over segments and languages, in a stable order. */
export function nextBatch(audience: Audience, n: number): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of audience.eligible.filter((c) => c.dueNow)) groups.set(`${c.segment}|${c.language}`, [...(groups.get(`${c.segment}|${c.language}`) ?? []), c]);
  const lists = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, l]) => l.sort((a, b) => bucket(a.userId).localeCompare(bucket(b.userId))));
  const out: Candidate[] = [];
  for (let i = 0; out.length < n && lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i] && out.length < n) out.push(l[i]!);
  return out;
}

/** Code the operator copies from the dry run: ties a send to the exact batch and the wording version. */
export function approvalCode(step: Step, batch: Candidate[]): string {
  return createHash('sha256')
    .update([CAMPAIGN, TEMPLATES_VERSION, step, ...batch.map((c) => `${c.userId}:${c.variant}:${c.language}`)].join('|'))
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
}

// ---------------------------------------------------------------- readiness

export function senderIdentity(env: NodeJS.ProcessEnv = process.env): Sender | null {
  const name = env.CAMPAIGN_SENDER_NAME?.trim();
  const address = env.CAMPAIGN_SENDER_ADDRESS?.trim();
  const supportEmail = env.CAMPAIGN_SUPPORT_EMAIL?.trim();
  return name && address && supportEmail ? { name, address, supportEmail } : null;
}
/** Public base URL of the API (https) taken the way the unsubscribe links take it. */
const apiBaseUrl = () => oneClickUrl('x')?.replace(/\/email\/unsubscribe\?token=.*$/, '') ?? null;

export function preflight(): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (process.env.REACTIVATION_CAMPAIGN_SEND !== 'true') blockers.push('Sending is locked: REACTIVATION_CAMPAIGN_SEND is not "true" (it is only set for the run you approve).');
  if (config.EMAIL_PROVIDER === 'disabled') blockers.push('EMAIL_PROVIDER is disabled.');
  if (!config.WEB_APP_URL) blockers.push('WEB_APP_URL is not set (the buttons need the web app address).');
  if (!apiBaseUrl()) blockers.push('API_PUBLIC_URL (or Render’s RENDER_EXTERNAL_URL) is missing: one-click unsubscribe and click tracking need the API’s public https address.');
  if (!senderIdentity()) blockers.push('Sender identity missing: set CAMPAIGN_SENDER_NAME, CAMPAIGN_SENDER_ADDRESS and CAMPAIGN_SUPPORT_EMAIL (every marketing email must say who sends it and where to write).');
  if (config.STUDY_REMINDER_EMAILS_ENABLED) warnings.push('Daily study reminders are on: people who got one in the last 7 days are skipped by this campaign.');
  if (config.EMAIL_PROVIDER === 'log') warnings.push('EMAIL_PROVIDER=log: nothing leaves the server (rehearsal only).');
  return { blockers, warnings };
}

export const maskEmail = (e: string) => e.replace(/^(.).*(@.)(.*)(\.[^.]+)$/, (_m, a, b, _c, d) => `${a}***${b}***${d}`);

// ---------------------------------------------------------------- sending

const appUrl = (target: string, step: Step, segment: Segment, variant: Variant) => {
  const u = new URL(target, `${config.WEB_APP_URL!.replace(/\/+$/, '')}/`);
  u.searchParams.set('utm_source', 'exama_email');
  u.searchParams.set('utm_medium', 'email');
  u.searchParams.set('utm_campaign', CAMPAIGN.replace(/-/g, '_'));
  u.searchParams.set('utm_content', `${segment}_${variant}_s${step}`);
  return u.toString();
};

async function claim(c: Candidate, step: Step, batchId: string): Promise<string | null> {
  const fresh = await db
    .insert(emailCampaignSends)
    .values({ campaign: CAMPAIGN, step, userId: c.userId, segment: c.segment, variant: c.variant, language: c.language, target: c.target, batchId })
    .onConflictDoNothing()
    .returning({ id: emailCampaignSends.id });
  if (fresh[0]) return fresh[0].id;
  const retry = await db
    .update(emailCampaignSends)
    .set({ status: 'claimed', attempts: pgIncrement(), batchId, error: null })
    .where(and(eq(emailCampaignSends.campaign, CAMPAIGN), eq(emailCampaignSends.step, step), eq(emailCampaignSends.userId, c.userId), eq(emailCampaignSends.status, 'failed'), lt(emailCampaignSends.attempts, MAX_ATTEMPTS)))
    .returning({ id: emailCampaignSends.id });
  return retry[0]?.id ?? null;
}
const pgIncrement = () => dsql`${emailCampaignSends.attempts} + 1`;

/** Last look before an email: the person may have withdrawn consent, unsubscribed, subscribed or been suppressed since the audience was chosen. */
async function stillOk(c: Candidate, includeLapsed: boolean): Promise<boolean> {
  const [row] = await pg<{ ok: boolean }[]>`
    select (u.study_reminder_emails and u.email_verified_at is not null and u.marketing_consent_at is not null
      and not exists (select 1 from email_suppressions s where s.email = lower(u.email))) as ok
    from users u where u.id = ${c.userId}`;
  if (!row?.ok) return false;
  if (includeLapsed) return true;
  return (await billingEligibility(c.userId)).ok;
}

export type SendReport = { batchId: string; attempted: number; sent: number; failed: number; skipped: number; stopped?: string };

export async function sendBatch(opts: {
  step: Step;
  batch: Candidate[];
  /** Hard ceilings for this run, on top of the approved batch. */
  limit: number;
  maxPerDay: number;
  batchSize?: number;
  gapMs?: number;
  pauseMs?: number;
  includeLapsed?: boolean;
  now?: Date;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SendReport> {
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const sender = senderIdentity();
  const base = apiBaseUrl();
  const batchId = `${CAMPAIGN}-s${opts.step}-${(opts.now ?? new Date()).toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
  const report: SendReport = { batchId, attempted: 0, sent: 0, failed: 0, skipped: 0 };
  if (!sender || !base || !config.WEB_APP_URL) return { ...report, stopped: 'not configured' };

  const [{ n: sentToday }] = await pg<{ n: number }[]>`
    select count(*)::int as n from email_campaign_sends where status = 'sent' and sent_at >= ${new Date((opts.now ?? new Date()).getTime() - DAY_MS).toISOString()}::timestamptz`;
  const allowed = Math.max(0, Math.min(opts.limit, opts.maxPerDay - sentToday, opts.batch.length));
  if (allowed === 0) return { ...report, stopped: `daily cap reached (${sentToday} sent in the last 24 h, cap ${opts.maxPerDay})` };
  const todo = opts.batch.slice(0, allowed);
  const size = Math.max(1, opts.batchSize ?? 20);
  let consecutiveFailures = 0;

  for (let i = 0; i < todo.length; i++) {
    const c = todo[i]!;
    report.attempted++;
    if (!(await stillOk(c, !!opts.includeLapsed))) { report.skipped++; continue; }
    const sendId = await claim(c, opts.step, batchId);
    if (!sendId) { report.skipped++; continue; }
    // Marketing links only (stop the marketing category): never the daily study-plan email's links.
    const unsub = marketingUnsubscribeLinks(c.userId);
    const mail = buildCampaignEmail({
      to: c.email,
      name: c.name,
      language: c.language,
      step: opts.step,
      variant: c.variant,
      course: c.course,
      daysUntilExam: c.daysUntilExam,
      ctaUrl: `${base}/email/click/${sendId}`,
      unsubscribeUrl: unsub.pageUrl,
      oneClickUrl: unsub.oneClickUrl,
      sender,
      idempotencyKey: `${CAMPAIGN}/${opts.step}/${c.userId}`,
      tags: [
        { name: 'campaign', value: CAMPAIGN },
        { name: 'segment', value: c.segment },
        { name: 'variant', value: c.variant },
        { name: 'step', value: String(opts.step) },
      ],
    });
    try {
      const { id } = await sendMail(mail);
      await db.update(emailCampaignSends).set({ status: 'sent', sentAt: new Date(), providerMessageId: id }).where(eq(emailCampaignSends.id, sendId));
      report.sent++;
      consecutiveFailures = 0;
    } catch (err) {
      const status = /Resend responded (\d{3})/.exec(err instanceof Error ? err.message : '')?.[1];
      await db.update(emailCampaignSends).set({ status: 'failed', error: status ? `http_${status}` : 'error' }).where(eq(emailCampaignSends.id, sendId));
      report.failed++;
      consecutiveFailures++;
      log(`failed (${status ? `HTTP ${status}` : 'error'}) for one recipient`);
      if (status === '429' || status === '403' || status === '401') return { ...report, stopped: `provider answered ${status} (quota, domain or key problem)` };
      if (consecutiveFailures >= 3) return { ...report, stopped: '3 failures in a row' };
    }
    if (i < todo.length - 1) await sleep((i + 1) % size === 0 ? (opts.pauseMs ?? 60_000) : (opts.gapMs ?? 1_100));
  }
  return report;
}

// ---------------------------------------------------------------- clicks

const clickLimiter = new RateLimiter(120, 15 * 60_000, 'Too many requests.');
export const resetClickRateLimit = () => clickLimiter.reset();
const BOT_UA = /bot|crawl|spider|preview|scan|monitor|proofpoint|mimecast|barracuda|safelinks|urldefense|headless|curl\/|python-requests|go-http-client|java\/|wget/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Records a click on the email button (a link scanner counts separately) and returns where to send the person. */
export async function recordClick(sendId: string, opts: { userAgent?: string | null; ip: string; countIt: boolean }): Promise<string> {
  const home = `${config.WEB_APP_URL!.replace(/\/+$/, '')}/`;
  if (!UUID.test(sendId)) return home;
  const [row] = await db.select({ step: emailCampaignSends.step, segment: emailCampaignSends.segment, variant: emailCampaignSends.variant, target: emailCampaignSends.target }).from(emailCampaignSends).where(eq(emailCampaignSends.id, sendId));
  if (!row) return home;
  if (opts.countIt && clickLimiter.tryTake(opts.ip)) {
    const [{ n }] = await pg<{ n: number }[]>`select count(*)::int as n from email_campaign_clicks where send_id = ${sendId}`;
    if (n < 25) await db.insert(emailCampaignClicks).values({ sendId, suspectedBot: !opts.userAgent || BOT_UA.test(opts.userAgent) });
  }
  return appUrl(row.target, row.step as Step, row.segment as Segment, row.variant as Variant);
}

// ---------------------------------------------------------------- delivery status and suppression

/** Reads each sent email's latest event back from Resend; hard bounces and complaints go to the suppression list. */
export async function syncDelivery(opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; campaign?: string } = {}): Promise<{ checked: number; updated: number; suppressed: number; stopped?: string }> {
  const out = { checked: 0, updated: 0, suppressed: 0 } as { checked: number; updated: number; suppressed: number; stopped?: string };
  if (config.EMAIL_PROVIDER !== 'resend' || !config.RESEND_API_KEY) return { ...out, stopped: 'EMAIL_PROVIDER is not resend' };
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rows = await pg<{ id: string; message_id: string; email: string }[]>`
    select s.id, s.provider_message_id as message_id, u.email
    from email_campaign_sends s join users u on u.id = s.user_id
    where s.campaign = ${opts.campaign ?? CAMPAIGN} and s.status = 'sent' and s.provider_message_id is not null
      and (s.delivery_status is null or s.delivery_status not in ('bounced', 'complained'))
      and s.sent_at > now() - interval '10 days'`;
  for (const r of rows) {
    out.checked++;
    const res = await f(`https://api.resend.com/emails/${encodeURIComponent(r.message_id)}`, { headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) return { ...out, stopped: 'Resend rate limit' };
    if (!res.ok) continue;
    const last = ((await res.json().catch(() => null)) as { last_event?: unknown } | null)?.last_event;
    if (typeof last !== 'string') continue;
    await db.update(emailCampaignSends).set({ deliveryStatus: last, deliverySyncedAt: new Date() }).where(eq(emailCampaignSends.id, r.id));
    out.updated++;
    if (last === 'bounced' || last === 'complained') {
      await db.insert(emailSuppressions).values({ email: r.email.toLowerCase(), reason: last }).onConflictDoNothing();
      out.suppressed++;
    }
    await sleep(550);
  }
  return out;
}

export async function suppress(email: string, reason: 'manual' | 'bounced' | 'complained' = 'manual'): Promise<void> {
  await db.insert(emailSuppressions).values({ email: email.trim().toLowerCase(), reason }).onConflictDoNothing();
}

// ---------------------------------------------------------------- report

export type ReportRow = {
  step: number;
  segment: Segment;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  clicked: number;
  clickedIncludingScanners: number;
  returned: number;
  planCreated: number;
  studied: number;
  unsubscribed: number;
  subscribed: number;
};

/**
 * Results per step and audience. "Returned", "plan created", "studied" and "subscribed" count people who did it within
 * `windowDays` after the email; without a held-out group they show what happened, not what the email caused.
 */
export async function campaignReport(windowDays = 14): Promise<ReportRow[]> {
  const rows = await pg<Record<string, string | number>[]>`
    with s as (
      select e.step, e.segment, e.delivery_status, u.study_reminder_emails as reminders_on,
        exists (select 1 from email_campaign_clicks k where k.send_id = e.id and not k.suspected_bot) as clicked,
        exists (select 1 from email_campaign_clicks k where k.send_id = e.id) as clicked_any,
        exists (select 1 from analytics_events a where a.user_id = e.user_id and a.name = 'app_opened' and a.source = 'client'
          and a.created_at > e.sent_at and a.created_at <= e.sent_at + make_interval(days => ${windowDays}) and a.properties->>'authenticated' = 'true') as returned,
        exists (select 1 from study_plans p where p.user_id = e.user_id and p.created_at > e.sent_at and p.created_at <= e.sent_at + make_interval(days => ${windowDays})) as plan_created,
        exists (select 1 from analytics_events a where a.user_id = e.user_id and a.name in ('exam_started', 'practice_started')
          and a.created_at > e.sent_at and a.created_at <= e.sent_at + make_interval(days => ${windowDays})) as studied,
        exists (select 1 from subscriptions b where b.user_id = e.user_id and b.created_at > e.sent_at) as subscribed
      from email_campaign_sends e join users u on u.id = e.user_id
      where e.campaign = ${CAMPAIGN} and e.status = 'sent')
    select step, segment, count(*)::int as sent,
      count(*) filter (where delivery_status in ('delivered', 'opened', 'clicked'))::int as delivered,
      count(*) filter (where delivery_status = 'bounced')::int as bounced,
      count(*) filter (where delivery_status = 'complained')::int as complained,
      count(*) filter (where clicked)::int as clicked,
      count(*) filter (where clicked_any)::int as clicked_any,
      count(*) filter (where returned)::int as returned,
      count(*) filter (where plan_created)::int as plan_created,
      count(*) filter (where studied)::int as studied,
      count(*) filter (where not reminders_on)::int as unsubscribed,
      count(*) filter (where subscribed)::int as subscribed
    from s group by step, segment order by step, segment`;
  return rows.map((r) => ({
    step: Number(r.step),
    segment: r.segment as Segment,
    sent: Number(r.sent),
    delivered: Number(r.delivered),
    bounced: Number(r.bounced),
    complained: Number(r.complained),
    clicked: Number(r.clicked),
    clickedIncludingScanners: Number(r.clicked_any),
    returned: Number(r.returned),
    planCreated: Number(r.plan_created),
    studied: Number(r.studied),
    unsubscribed: Number(r.unsubscribed),
    subscribed: Number(r.subscribed),
  }));
}
