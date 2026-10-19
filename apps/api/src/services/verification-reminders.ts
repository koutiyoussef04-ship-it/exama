/**
 * One reminder to confirm the email address, for accounts that never confirmed it.
 *
 * This is NOT marketing. It is the same account message the student already got at sign-up (services/email-verification.ts):
 * the same link, expiry and single-use token, nothing else in it (no study plan, offer or "come back"), and it says it is
 * the only reminder. Verification stays mandatory and is never granted here: only the student opening the link marks
 * the address confirmed, and until then the marketing campaigns (reactivation-campaign.ts) and the daily study
 * emails keep leaving the account out.
 *
 * Run by an operator (scripts/verification-reminders.ts), never by the server: deploying sends nothing.
 *
 * Who gets it (every rule is read from the database on every run; anything unclear → no email):
 *   - address not confirmed, not on the suppression list, and no earlier Exama email to it bounced or was
 *     complained about (read from Resend's own delivery log, `fetchDeliveryHistory`);
 *   - an account that was asked at sign-up (`email_verification_required`). Accounts that predate verification were
 *     never asked: they are held out unless the operator includes them (`--include-legacy`);
 *   - older than 24 h (the sign-up link has expired and had its chance) and younger than `maxAgeDays` (30), so nobody
 *     gets a surprise email about an account they made long ago;
 *   - no verification link sent in the last 24 h (the student may be about to use it, or just asked for a new one);
 *   - never reminded before: at most ONE reminder per account, ever (any `verification-reminder-*` campaign).
 *
 * Never twice: a row (campaign, step, user) in `email_campaign_sends` is claimed before the send (unique), Resend gets
 * an idempotency key for the same triple, and the account is checked again just before each email. A failed send is
 * retried by a later run (3 attempts). A send that crashes between claim and result stays "claimed" and is never
 * repeated automatically. The token itself goes through `sendVerificationReminder`, so the 60-second cooldown, the
 * hourly per-account limit and "a failed send removes the link" are the existing rules, not copies of them.
 *
 * Controlled sending: dry run by default; a send needs VERIFICATION_REMINDER_SEND=true (a different switch from the
 * reactivation campaign's), a per-run limit, an approval code that depends on the exact batch and the wording version,
 * a per-day cap (the Resend free plan allows 100 emails a day for everything), small batches with pauses, and it stops
 * at the first sign of trouble (quota, domain or three failures in a row).
 */
import { createHash } from 'node:crypto';
import { and, eq, lt, sql as dsql } from 'drizzle-orm';
import { EMAIL_VERIFICATION_TTL_HOURS, type Language } from '@study/shared';
import { config } from '../config.js';
import { db, sql as pg } from '../db/client.js';
import { emailCampaignSends } from '../db/schema.js';
import { sendVerificationReminder, verificationAvailable } from './email-verification.js';
import { isValidTimeZone } from './planner/dates.js';
import { resolve4, resolve6, resolveMx } from 'node:dns/promises';
import { maskEmail, suppress, syncDelivery } from './reactivation-campaign.js';
import { deviceSignals, localHour } from './study-reminders.js';

export const REMINDER_CAMPAIGN = 'verification-reminder-2026-10';
/** Every reminder campaign, present and future: an account is reminded once across all of them. */
export const REMINDER_CAMPAIGN_PREFIX = 'verification-reminder-';
/** Bump when the wording changes: it invalidates earlier approval codes. */
export const REMINDER_VERSION = '2026-10-v1';
export const REMINDER_VARIANT = 'verification_reminder';
export const REMINDER_STEP = 1;
export const MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_ACCOUNT_AGE_DAYS = 30;
export const DEFAULT_MAX_PER_DAY = 20;
/** Resend free plan, shared with password-reset, sign-up verification and the other emails. */
export const RESEND_DAILY_LIMIT = 100;
const TTL_MS = EMAIL_VERIFICATION_TTL_HOURS * 3_600_000;
const DAY_MS = 86_400_000;
/** Daytime, not the evening campaign window: it is an account message. Unknown zone: 08:00–19:00 UTC (Europe, Americas mornings). */
const LOCAL_WINDOW = { from: 9, to: 20 };
const UNKNOWN_ZONE_UTC_WINDOW = { from: 8, to: 19 };

export type ReminderExclude =
  | 'suppressed'
  | 'delivery_failed_before'
  | 'already_reminded'
  | 'legacy_not_asked'
  | 'too_old'
  | 'too_new'
  | 'link_still_valid';

export type ReminderCandidate = {
  userId: string;
  email: string;
  language: Language;
  timeZone: string | null;
  /** Asked at sign-up (false: an account that predates verification, included only with `includeLegacy`). */
  asked: boolean;
  /** `none`: no link on record (the sign-up email never went out or failed); `expired`: a link was sent and nobody used it. */
  link: 'none' | 'expired';
  dueNow: boolean;
};

export type ReminderAudience = {
  now: Date;
  usersTotal: number;
  /** Accounts whose address is not confirmed (the population this tool looks at). */
  unverified: number;
  eligible: ReminderCandidate[];
  excluded: Partial<Record<ReminderExclude, number>>;
  /** What the unverified accounts would be once they confirm, for the marketing campaign's own rules (age and plan); informational. */
  afterConfirming: { adult: number; minor: number; noAge: number; withPlan: number };
};

const isLang = (l: unknown): l is Language => l === 'en' || l === 'es' || l === 'fr' || l === 'ar';
const bucket = (userId: string) => createHash('sha256').update(`${REMINDER_CAMPAIGN}:${userId}`).digest('hex');
const ADULT = new Set(['18_24', '25_34', '35_plus']);

export function inReminderWindow(now: Date, timeZone: string | null): boolean {
  if (timeZone && isValidTimeZone(timeZone)) {
    const h = localHour(now, timeZone);
    return h >= LOCAL_WINDOW.from && h < LOCAL_WINDOW.to;
  }
  const h = now.getUTCHours();
  return h >= UNKNOWN_ZONE_UTC_WINDOW.from && h < UNKNOWN_ZONE_UTC_WINDOW.to;
}

// ---------------------------------------------------------------- Resend's own delivery log

export type DeliveryHistory = {
  /** lowercased address → how Exama's earlier emails to it ended. `bad`: the first bounce, complaint or suppression Resend recorded. */
  byAddress: Map<string, { emails: number; bad: 'bounced' | 'complained' | 'suppressed' | null }>;
  emails: number;
  /** false when the log was longer than `maxPages` pages, or a page could not be followed: addresses further back are unknown. */
  complete: boolean;
};

/**
 * Why the Resend log could not be read. `permission`: the key may only send (Resend answers 401/403 `restricted_api_key`:
 * reading needs a Full access key). `timeout` and `network` are a slow or unreachable Resend (or this machine's network);
 * `rate_limit` is Resend's 10 requests/second (or a quota); `deadline` is the whole lookup exceeding its budget.
 * Never carries a response body, an address or the key: only the status, Resend's error name and the timings.
 */
export type ResendLogFailure = 'permission' | 'timeout' | 'network' | 'rate_limit' | 'server' | 'http' | 'shape' | 'deadline';
export class ResendLogError extends Error {
  constructor(
    readonly kind: ResendLogFailure,
    message: string,
    readonly detail: { status?: number; name?: string; attempts: number; elapsedMs: number },
  ) {
    super(message);
    this.name = 'ResendLogError';
  }
}

export type LogAttempt = { attempt: number; outcome: 'ok' | 'timeout' | 'network' | 'http'; status?: number; name?: string; ms: number };
export type HistoryOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Clock (ms), for the overall deadline; tests move it with `sleep`. */
  now?: () => number;
  /** Pages of 100 emails to read before saying the log is incomplete (default 40 = 4000 emails; the free plan sends at most 3000 a month). */
  maxPages?: number;
  /** Per request (default 30 s). A slow answer is retried; it never hangs the run. */
  requestTimeoutMs?: number;
  /** Tries per page for timeouts, network errors, 5xx and rate limits (default 3). Reading is idempotent, so retrying is safe. */
  attempts?: number;
  /** Budget for the whole lookup, retries and waits included (default 120 s). */
  deadlineMs?: number;
  /** Called after every request (diagnostics). */
  onAttempt?: (info: LogAttempt) => void;
};

const BAD = new Set(['bounced', 'complained', 'suppressed']);
const addressOf = (to: unknown) => {
  const raw = typeof to === 'string' ? to : '';
  return (/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim().toLowerCase();
};
const QUOTA_ERRORS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);
const isAbort = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
/** The body as JSON; `undefined` when it is not JSON. A timeout while reading the body is rethrown (it is a timeout, not a bad answer). */
const readJson = (res: Response): Promise<unknown> =>
  res.json().catch((e: unknown) => {
    if (isAbort(e)) throw e;
    return undefined;
  });

/** One GET with a per-request timeout and bounded retries (timeouts, network errors, 5xx, rate limits). Honours Retry-After. */
async function getWithRetries(url: string, o: Required<Pick<HistoryOptions, 'requestTimeoutMs' | 'attempts' | 'deadlineMs'>> & HistoryOptions, f: typeof fetch, sleep: (ms: number) => Promise<void>, now: () => number, started: number): Promise<unknown> {
  let last: ResendLogError | null = null;
  for (let attempt = 1; attempt <= o.attempts; attempt++) {
    const elapsed = () => now() - started;
    const remaining = o.deadlineMs - elapsed();
    if (remaining <= 0) throw new ResendLogError('deadline', `Reading Resend’s log took longer than ${Math.round(o.deadlineMs / 1000)} s${last ? ` (last problem: ${last.message})` : ''}`, { attempts: attempt - 1, elapsedMs: elapsed(), status: last?.detail.status, name: last?.detail.name });
    const t0 = now();
    let wait = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250);
    try {
      const res = await f(url, { headers: { Authorization: `Bearer ${config.RESEND_API_KEY}` }, signal: AbortSignal.timeout(Math.min(o.requestTimeoutMs, remaining)) });
      const status = res.status;
      if (res.ok) {
        const body = await readJson(res);
        o.onAttempt?.({ attempt, outcome: 'ok', status, ms: now() - t0 });
        if (body === undefined) throw new ResendLogError('shape', 'Unexpected Resend answer (not JSON)', { status, attempts: attempt, elapsedMs: elapsed() });
        return body;
      }
      const name = ((await readJson(res)) as { name?: unknown } | null | undefined)?.name;
      const errName = typeof name === 'string' ? name.slice(0, 60) : undefined;
      o.onAttempt?.({ attempt, outcome: 'http', status, name: errName, ms: now() - t0 });
      const detail = { status, name: errName, attempts: attempt, elapsedMs: elapsed() };
      if (status === 401 || status === 403) {
        if (errName && QUOTA_ERRORS.has(errName)) throw new ResendLogError('rate_limit', `Resend refused: ${errName}`, detail);
        throw new ResendLogError('permission', errName === 'restricted_api_key' ? `Resend refused the key (${status} restricted_api_key): reading the log needs a Full access API key` : `Resend refused the key (${status}${errName ? ` ${errName}` : ''})`, detail);
      }
      if (status === 429) {
        if (errName && QUOTA_ERRORS.has(errName)) throw new ResendLogError('rate_limit', `Resend responded 429 ${errName}`, detail);
        const retryAfter = Number(res.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) wait = Math.min(retryAfter, 15) * 1000;
        last = new ResendLogError('rate_limit', 'Resend responded 429 (rate limit)', detail);
      } else if (status >= 500) {
        last = new ResendLogError('server', `Resend responded ${status}${errName ? ` ${errName}` : ''}`, detail);
      } else {
        throw new ResendLogError('http', `Resend responded ${status}${errName ? ` ${errName}` : ''}`, detail);
      }
    } catch (err) {
      if (err instanceof ResendLogError) {
        throw err; // permanent (wrong key, bad request, quota, unreadable answer): retrying cannot help
      } else {
        const timedOut = isAbort(err);
        const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
        o.onAttempt?.({ attempt, outcome: timedOut ? 'timeout' : 'network', ms: now() - t0 });
        last = new ResendLogError(
          timedOut ? 'timeout' : 'network',
          timedOut ? `Resend did not answer within ${Math.round(o.requestTimeoutMs / 1000)} s` : `could not reach Resend${typeof cause === 'string' ? ` (${cause})` : ''}`,
          { attempts: attempt, elapsedMs: elapsed() },
        );
      }
    }
    if (attempt < o.attempts) await sleep(wait);
  }
  throw new ResendLogError(last!.kind, `${last!.message} (${o.attempts} attempts)`, { ...last!.detail, attempts: o.attempts, elapsedMs: now() - started });
}

/**
 * Every email Exama recently sent (Resend `GET /emails`, 100 a page, newest first) with its last delivery event. The sign-up
 * verification emails don't store a Resend id, so this is how a hard bounce of the sign-up email is known: sending again to an
 * address that bounced only adds a second bounce (Resend warns above about 4–5%, and this account sends very few emails).
 *
 * Reliable, not lenient: each request has its own timeout and is retried a few times with backoff (it is a read), the cursor
 * must move forward, the whole lookup has a deadline, and ANY remaining problem throws a `ResendLogError` with its kind.
 * Callers must not send without it. Results are never cached: a stale "no bounce" is exactly what this check must not trust.
 */
export async function fetchDeliveryHistory(opts: HistoryOptions = {}): Promise<DeliveryHistory> {
  if (config.EMAIL_PROVIDER !== 'resend' || !config.RESEND_API_KEY) throw new Error('EMAIL_PROVIDER is not resend');
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const o = { ...opts, requestTimeoutMs: opts.requestTimeoutMs ?? 30_000, attempts: Math.max(1, opts.attempts ?? 3), deadlineMs: opts.deadlineMs ?? 120_000 };
  const maxPages = opts.maxPages ?? 40;
  const started = now();
  const out: DeliveryHistory = { byAddress: new Map(), emails: 0, complete: true };
  let after: string | null = null;
  for (let page = 0; ; page++) {
    if (page >= maxPages) return { ...out, complete: false };
    const url: string = `https://api.resend.com/emails?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const body = (await getWithRetries(url, o, f, sleep, now, started)) as { data?: unknown; has_more?: unknown } | null;
    if (!body || !Array.isArray(body.data)) throw new ResendLogError('shape', 'Unexpected Resend answer (no data list)', { attempts: 1, elapsedMs: now() - started });
    for (const item of body.data as { id?: unknown; to?: unknown; last_event?: unknown }[]) {
      out.emails++;
      const last = typeof item.last_event === 'string' ? item.last_event : null;
      for (const to of Array.isArray(item.to) ? item.to : [item.to]) {
        const address = addressOf(to);
        if (!address) continue;
        const entry = out.byAddress.get(address) ?? { emails: 0, bad: null };
        entry.emails++;
        if (!entry.bad && last && BAD.has(last)) entry.bad = last as 'bounced' | 'complained' | 'suppressed';
        out.byAddress.set(address, entry);
      }
    }
    if (body.has_more !== true) return out;
    const lastId: unknown = (body.data[body.data.length - 1] as { id?: unknown } | undefined)?.id;
    // A page that says "more" but gives no new cursor would loop forever: stop, and say the log is incomplete.
    if (typeof lastId !== 'string' || lastId === after) return { ...out, complete: false };
    after = lastId;
    await sleep(150); // Resend allows 10 requests a second, shared with everything else Exama sends
  }
}

// ---------------------------------------------------------------- who

type Row = {
  id: string;
  email: string;
  created_ms: number;
  age_range: string | null;
  asked: boolean;
  suppressed: boolean;
  links: number;
  last_link_ms: number | null;
  has_plan: boolean;
};

/** Everyone whose address is not confirmed, classified: eligible candidates and, for the rest, the first rule that excludes them. */
export async function selectReminderAudience(opts: { now?: Date; maxAgeDays?: number; includeLegacy?: boolean; anyTime?: boolean; userIds?: string[]; history?: DeliveryHistory | null } = {}): Promise<ReminderAudience> {
  const now = opts.now ?? new Date();
  const maxAgeMs = (opts.maxAgeDays ?? DEFAULT_MAX_ACCOUNT_AGE_DAYS) * DAY_MS;
  const only = opts.userIds ?? null;
  const [{ n: usersTotal }] = await pg<{ n: number }[]>`select count(*)::int as n from users where (${only}::uuid[] is null or id = any(${only}::uuid[]))`;
  const rows = await pg<Row[]>`
    select u.id, u.email, (extract(epoch from u.created_at) * 1000)::float8 as created_ms, u.age_range,
      u.email_verification_required as asked,
      exists (select 1 from email_suppressions s where s.email = lower(u.email)) as suppressed,
      (select count(*) from email_verification_tokens t where t.user_id = u.id)::int as links,
      (select extract(epoch from max(t.created_at)) * 1000 from email_verification_tokens t where t.user_id = u.id)::float8 as last_link_ms,
      exists (select 1 from study_plans p where p.user_id = u.id) as has_plan
    from users u
    where u.email_verified_at is null and (${only}::uuid[] is null or u.id = any(${only}::uuid[]))
    order by u.created_at`;
  const excluded: ReminderAudience['excluded'] = {};
  const out = (r: ReminderExclude) => void (excluded[r] = (excluded[r] ?? 0) + 1);
  const afterConfirming = { adult: 0, minor: 0, noAge: 0, withPlan: 0 };
  for (const r of rows) {
    if (!r.age_range) afterConfirming.noAge++;
    else if (ADULT.has(r.age_range)) afterConfirming.adult++;
    else afterConfirming.minor++;
    if (r.has_plan) afterConfirming.withPlan++;
  }
  const audience: ReminderAudience = { now, usersTotal, unverified: rows.length, eligible: [], excluded, afterConfirming };
  if (!rows.length) return audience;

  type Reminded = { user_id: string; campaign: string; status: string; attempts: number };
  const reminded = await pg<Reminded[]>`
    select user_id, campaign, status, attempts from email_campaign_sends
    where campaign like ${`${REMINDER_CAMPAIGN_PREFIX}%`} and user_id = any(${rows.map((r) => r.id)}::uuid[])`;
  const remindedBy = new Map<string, Reminded[]>();
  for (const r of reminded) remindedBy.set(r.user_id, [...(remindedBy.get(r.user_id) ?? []), r]);

  for (const r of rows) {
    if (r.suppressed) { out('suppressed'); continue; }
    if (opts.history?.byAddress.get(r.email.toLowerCase())?.bad) { out('delivery_failed_before'); continue; }
    // A failed attempt of this campaign (fewer than 3) is retried; anything else, in any reminder campaign, means "already reminded".
    if ((remindedBy.get(r.id) ?? []).some((s) => !(s.campaign === REMINDER_CAMPAIGN && s.status === 'failed' && s.attempts < MAX_ATTEMPTS))) { out('already_reminded'); continue; }
    if (!r.asked && !opts.includeLegacy) { out('legacy_not_asked'); continue; }
    const age = now.getTime() - r.created_ms;
    if (age > maxAgeMs) { out('too_old'); continue; }
    if (age < TTL_MS) { out('too_new'); continue; }
    if (r.last_link_ms !== null && now.getTime() - r.last_link_ms < TTL_MS) { out('link_still_valid'); continue; }
    const device = await deviceSignals(r.id);
    const language: Language = isLang(device.language) ? device.language : 'en';
    audience.eligible.push({ userId: r.id, email: r.email, language, timeZone: device.timeZone, asked: r.asked, link: r.links === 0 ? 'none' : 'expired', dueNow: !!opts.anyTime || inReminderWindow(now, device.timeZone) });
  }
  return audience;
}

/** The next `n` emails to send: those due now, spread over languages, in a stable order. */
export function nextReminderBatch(audience: ReminderAudience, n: number): ReminderCandidate[] {
  const groups = new Map<string, ReminderCandidate[]>();
  for (const c of audience.eligible.filter((c) => c.dueNow)) groups.set(c.language, [...(groups.get(c.language) ?? []), c]);
  const lists = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, l]) => l.sort((a, b) => bucket(a.userId).localeCompare(bucket(b.userId))));
  const out: ReminderCandidate[] = [];
  for (let i = 0; out.length < n && lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i] && out.length < n) out.push(l[i]!);
  return out;
}

/** Code the operator copies from the dry run: ties a send to the exact batch and the wording version. */
export function reminderApprovalCode(batch: ReminderCandidate[]): string {
  return createHash('sha256')
    .update([REMINDER_CAMPAIGN, REMINDER_VERSION, ...batch.map((c) => `${c.userId}:${c.language}`)].join('|'))
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
}

// ---------------------------------------------------------------- readiness

export function reminderPreflight(): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (process.env.VERIFICATION_REMINDER_SEND !== 'true') blockers.push('Sending is locked: VERIFICATION_REMINDER_SEND is not "true" (it is only set for the run you approve; REACTIVATION_CAMPAIGN_SEND does not unlock this).');
  if (config.EMAIL_PROVIDER === 'disabled') blockers.push('EMAIL_PROVIDER is disabled.');
  if (!config.WEB_APP_URL) blockers.push('WEB_APP_URL is not set (the link needs the web app address).');
  if (!verificationAvailable() && !blockers.length) blockers.push('Email verification is not available (EMAIL_PROVIDER / WEB_APP_URL).');
  if (config.EMAIL_PROVIDER === 'log') warnings.push('EMAIL_PROVIDER=log: nothing leaves the server (rehearsal only).');
  return { blockers, warnings };
}

// ---------------------------------------------------------------- sending

type Claim = { id: string; fresh: boolean };

async function claim(c: ReminderCandidate, batchId: string): Promise<Claim | null> {
  const fresh = await db
    .insert(emailCampaignSends)
    .values({ campaign: REMINDER_CAMPAIGN, step: REMINDER_STEP, userId: c.userId, segment: 'unverified', variant: REMINDER_VARIANT, language: c.language, target: '/verify-email', batchId })
    .onConflictDoNothing()
    .returning({ id: emailCampaignSends.id });
  if (fresh[0]) return { id: fresh[0].id, fresh: true };
  const retry = await db
    .update(emailCampaignSends)
    .set({ status: 'claimed', attempts: dsql`${emailCampaignSends.attempts} + 1`, batchId, error: null })
    .where(and(eq(emailCampaignSends.campaign, REMINDER_CAMPAIGN), eq(emailCampaignSends.step, REMINDER_STEP), eq(emailCampaignSends.userId, c.userId), eq(emailCampaignSends.status, 'failed'), lt(emailCampaignSends.attempts, MAX_ATTEMPTS)))
    .returning({ id: emailCampaignSends.id });
  return retry[0] ? { id: retry[0].id, fresh: false } : null;
}

/** Last look before an email: the student may have confirmed, asked for a new link or been suppressed since the audience was chosen. */
async function stillOk(c: ReminderCandidate): Promise<boolean> {
  const [row] = await pg<{ ok: boolean }[]>`
    select (u.email_verified_at is null
      and not exists (select 1 from email_suppressions s where s.email = lower(u.email))
      and not exists (select 1 from email_verification_tokens t where t.user_id = u.id and t.created_at > now() - make_interval(secs => ${TTL_MS / 1000}))
      and not exists (select 1 from email_campaign_sends e where e.user_id = u.id and e.campaign like ${`${REMINDER_CAMPAIGN_PREFIX}%`}
        and not (e.campaign = ${REMINDER_CAMPAIGN} and e.status = 'failed' and e.attempts < ${MAX_ATTEMPTS}))) as ok
    from users u where u.id = ${c.userId}`;
  return !!row?.ok;
}

export type ReminderSendReport = { batchId: string; attempted: number; sent: number; failed: number; skipped: number; stopped?: string };

export async function sendReminderBatch(opts: {
  batch: ReminderCandidate[];
  /** Hard ceilings for this run, on top of the approved batch. */
  limit: number;
  maxPerDay: number;
  batchSize?: number;
  gapMs?: number;
  pauseMs?: number;
  now?: Date;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ReminderSendReport> {
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? new Date();
  const batchId = `${REMINDER_CAMPAIGN}-${now.toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
  const report: ReminderSendReport = { batchId, attempted: 0, sent: 0, failed: 0, skipped: 0 };
  if (!verificationAvailable()) return { ...report, stopped: 'email verification is not available (EMAIL_PROVIDER / WEB_APP_URL)' };

  // One daily budget for every Exama campaign email (the reactivation campaign counts too).
  const [{ n: sentToday }] = await pg<{ n: number }[]>`
    select count(*)::int as n from email_campaign_sends where status = 'sent' and sent_at >= ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamptz`;
  const allowed = Math.max(0, Math.min(opts.limit, opts.maxPerDay - sentToday, opts.batch.length));
  if (allowed === 0) return { ...report, stopped: `daily cap reached (${sentToday} campaign emails sent in the last 24 h, cap ${opts.maxPerDay})` };
  const todo = opts.batch.slice(0, allowed);
  const size = Math.max(1, opts.batchSize ?? 20);
  let consecutiveFailures = 0;

  for (let i = 0; i < todo.length; i++) {
    const c = todo[i]!;
    report.attempted++;
    if (!(await stillOk(c))) { report.skipped++; continue; }
    const claimed = await claim(c, batchId);
    if (!claimed) { report.skipped++; continue; }
    const result = await sendVerificationReminder(c.userId, c.language, {
      now: now.getTime(),
      idempotencyKey: `${REMINDER_CAMPAIGN}/${REMINDER_STEP}/${c.userId}`,
      tags: [
        { name: 'campaign', value: REMINDER_CAMPAIGN },
        { name: 'variant', value: REMINDER_VARIANT },
      ],
    });
    if (result.status === 'sent') {
      await db.update(emailCampaignSends).set({ status: 'sent', sentAt: new Date(), providerMessageId: result.id }).where(eq(emailCampaignSends.id, claimed.id));
      report.sent++;
      consecutiveFailures = 0;
    } else if (result.status === 'failed') {
      const status = /Resend responded (\d{3})/.exec(result.error)?.[1];
      await db.update(emailCampaignSends).set({ status: 'failed', error: status ? `http_${status}` : 'error' }).where(eq(emailCampaignSends.id, claimed.id));
      report.failed++;
      consecutiveFailures++;
      log(`failed (${status ? `HTTP ${status}` : 'error'}) for one recipient`);
      if (status === '429' || status === '403' || status === '401') return { ...report, stopped: `provider answered ${status} (quota, domain or key problem)` };
      if (consecutiveFailures >= 3) return { ...report, stopped: '3 failures in a row' };
    } else {
      // Nothing was emailed (confirmed meanwhile, new link requested a moment ago, hourly limit…): give the claim back.
      if (claimed.fresh) await db.delete(emailCampaignSends).where(and(eq(emailCampaignSends.id, claimed.id), eq(emailCampaignSends.status, 'claimed')));
      else await db.update(emailCampaignSends).set({ status: 'failed', error: result.status, attempts: dsql`${emailCampaignSends.attempts} - 1` }).where(eq(emailCampaignSends.id, claimed.id));
      report.skipped++;
      log(`skipped one recipient (${result.status})`);
    }
    if (i < todo.length - 1) await sleep((i + 1) % size === 0 ? (opts.pauseMs ?? 60_000) : (opts.gapMs ?? 1_100));
  }
  return report;
}

// ---------------------------------------------------------------- diagnostics (read-only)

export type ResendDiagnosis = {
  /** An unauthenticated request: Resend answers 401 within milliseconds when the network path works. */
  network: { ok: boolean; status?: number; ms: number; error?: string };
  /** The same read the dry run needs, with the production key, traced attempt by attempt. */
  key: { ok: boolean; kind?: ResendLogFailure; message?: string; status?: number; name?: string; emailsOnFirstPage?: number; attempts: LogAttempt[]; ms: number };
};

/**
 * Why can't the delivery log be read? Sends nothing and changes nothing: two GETs (one without a key, one with it)
 * and a verdict. Never prints the key or a response body.
 */
export async function diagnoseResend(opts: HistoryOptions = {}): Promise<ResendDiagnosis> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const t0 = now();
  const network: ResendDiagnosis['network'] = { ok: false, ms: 0 };
  try {
    const res = await f('https://api.resend.com/emails?limit=1', { signal: AbortSignal.timeout(opts.requestTimeoutMs ?? 30_000) });
    network.status = res.status;
    network.ok = res.status === 401; // no key: 401 missing_api_key means the API answered
  } catch (err) {
    network.error = isAbort(err) ? 'timeout' : `network error${typeof (err as { cause?: { code?: unknown } })?.cause?.code === 'string' ? ` (${(err as { cause: { code: string } }).cause.code})` : ''}`;
  }
  network.ms = now() - t0;

  const attempts: LogAttempt[] = [];
  const t1 = now();
  try {
    const h = await fetchDeliveryHistory({ ...opts, maxPages: 1, onAttempt: (a) => attempts.push(a) });
    return { network, key: { ok: true, emailsOnFirstPage: h.emails, attempts, ms: now() - t1 } };
  } catch (err) {
    if (err instanceof ResendLogError) return { network, key: { ok: false, kind: err.kind, message: err.message, status: err.detail.status, name: err.detail.name, attempts, ms: now() - t1 } };
    return { network, key: { ok: false, message: err instanceof Error ? err.message : 'error', attempts, ms: now() - t1 } };
  }
}

/** Plain-language verdict for `diagnoseResend`. */
export function explainDiagnosis(d: ResendDiagnosis): string {
  if (d.key.ok) return 'The key can read the delivery log: nothing to fix here.';
  if (!d.network.ok) return `This machine could not get a normal answer from api.resend.com even without a key (${d.network.error ?? `HTTP ${d.network.status}`}): a network or DNS problem on this side, not the key.`;
  switch (d.key.kind) {
    case 'permission':
      return d.key.name === 'restricted_api_key'
        ? 'The API key is send-only (Resend answered restricted_api_key). Create a key with Full access in Resend → API Keys and set it as RESEND_API_KEY; sending-only keys cannot read the log.'
        : `Resend refused the API key (${d.key.status}${d.key.name ? ` ${d.key.name}` : ''}): it is missing, revoked or not allowed to read. Check RESEND_API_KEY.`;
    case 'timeout':
      return 'The API is reachable, but the delivery-log request did not answer in time on every attempt: Resend was slow. Run this again; if it keeps happening, the timeout is the problem, not the key.';
    case 'rate_limit':
      return 'Resend is rate-limiting (10 requests a second for the whole team) or the quota is used up: wait a minute and retry.';
    case 'server':
      return 'Resend answered with a server error on every attempt: try again later.';
    default:
      if (d.key.kind === 'http' && d.key.status === 400 && d.key.name === 'validation_error') return 'Resend says the API key is invalid (HTTP 400 validation_error): RESEND_API_KEY is mistyped, revoked or not a Resend key.';
      return `The delivery log could not be read (${d.key.message ?? 'unknown problem'}).`;
  }
}

// ---------------------------------------------------------------- legacy accounts (read-only)

const MAJOR_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'yahoo.es', 'outlook.com', 'outlook.fr', 'outlook.es', 'hotmail.com', 'hotmail.fr', 'hotmail.es', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'yandex.com', 'mail.com', 'orange.fr', 'free.fr', 'wanadoo.fr', 'laposte.net', 'sfr.fr']);
const DISPOSABLE_DOMAINS = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mailnesia.com', 'mohmal.com']);
const ROLE_LOCALPARTS = new Set(['admin', 'administrator', 'info', 'support', 'contact', 'hello', 'noreply', 'no-reply', 'donotreply', 'test', 'tester', 'example', 'sales', 'office', 'postmaster', 'abuse', 'webmaster', 'root', 'mail', 'help']);
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type LegacyRow = { masked: string; day: string; domain: string; flags: string[]; signedIn: boolean; lastActiveDaysAgo: number | null; courses: number; plans: number };
export type LegacyReport = {
  total: number;
  /** UTC day → accounts registered that day. */
  byDay: { day: string; n: number }[];
  ageGroup: { given: number; none: number };
  activity: { loggedInAfterSignup: number; openedAppSignedIn: number; activeLast7Days: number; neverActive: number; withCourse: number; withPlan: number };
  domains: { top: { domain: string; n: number }[]; otherDomains: number; otherAccounts: number };
  hygiene: { invalidSyntax: number; roleAccount: number; disposable: number; sharedMailbox: number; noMailServer: number; lookupInconclusive: number };
  suppressed: number;
  /** Earlier Exama emails to these addresses, from Resend's log (null: log not read). */
  delivery: { addressesEmailed: number; bounced: number } | null;
  rows: LegacyRow[];
};

/** An address with only its first character, its domain's first character and its extension; anything that doesn't look like an address, only its first character. */
const mask = (email: string) => {
  const m = maskEmail(email);
  return m === email ? `${email.slice(0, 1)}***` : m;
};

const mailboxKey = (email: string) => {
  const [local = '', domain = ''] = email.toLowerCase().split('@');
  const base = local.split('+')[0]!;
  return `${domain === 'googlemail.com' ? 'gmail.com' : domain}|${domain === 'gmail.com' || domain === 'googlemail.com' ? base.replace(/\./g, '') : base}`;
};

/**
 * Accounts that were never asked to confirm (they predate verification), looked at without touching them: when and how they were
 * made (registration day), whether anyone ever came back, and whether the address looks real and current. Aggregated, with
 * addresses masked: safe to paste. Reads the database, optionally Resend's log (passed in) and DNS (domain names only). It
 * sends nothing, changes nothing, and does not include anyone in anything.
 */
export async function inspectLegacy(opts: { now?: Date; history?: DeliveryHistory | null; mx?: (domain: string) => Promise<'ok' | 'none' | 'unknown'>; userIds?: string[] } = {}): Promise<LegacyReport> {
  const now = opts.now ?? new Date();
  const only = opts.userIds ?? null;
  // "No mail server" only when there is neither an MX record nor an address record (RFC 5321: a domain with just an A/AAAA record
  // accepts mail), so a resolver that can't answer MX queries doesn't turn real domains into false alarms. Any other DNS error is "unknown".
  const notFound = (err: unknown) => ['ENOTFOUND', 'ENODATA'].includes((err as { code?: string }).code ?? '');
  const mx =
    opts.mx ??
    (async (domain: string): Promise<'ok' | 'none' | 'unknown'> => {
      for (const lookup of [resolveMx, resolve4, resolve6] as const) {
        try {
          if ((await lookup(domain)).length) return 'ok';
        } catch (err) {
          if (!notFound(err)) return 'unknown';
        }
      }
      return 'none';
    });
  type R = { id: string; email: string; created_ms: number; age_range: string | null; suppressed: boolean; logged_in: boolean; opened: boolean; last_ms: number | null; courses: number; plans: number };
  const rows = await pg<R[]>`
    select u.id, u.email, (extract(epoch from u.created_at) * 1000)::float8 as created_ms, u.age_range,
      exists (select 1 from email_suppressions s where s.email = lower(u.email)) as suppressed,
      exists (select 1 from analytics_events a where a.user_id = u.id and a.name = 'login_completed') as logged_in,
      exists (select 1 from analytics_events a where a.user_id = u.id and a.name = 'app_opened' and a.source = 'client') as opened,
      (select extract(epoch from max(a.created_at)) * 1000 from analytics_events a where a.user_id = u.id and a.source = 'client')::float8 as last_ms,
      (select count(*) from documents d where d.user_id = u.id)::int as courses,
      (select count(*) from study_plans p where p.user_id = u.id)::int as plans
    from users u where u.email_verified_at is null and not u.email_verification_required and (${only}::uuid[] is null or u.id = any(${only}::uuid[])) order by u.created_at`;

  const byDay = new Map<string, number>();
  const domainCount = new Map<string, number>();
  const mailboxes = new Map<string, number>();
  const verdict = new Map<string, 'ok' | 'none' | 'unknown'>();
  for (const r of rows) {
    const domain = r.email.split('@')[1]?.toLowerCase() ?? '';
    domainCount.set(domain, (domainCount.get(domain) ?? 0) + 1);
    mailboxes.set(mailboxKey(r.email), (mailboxes.get(mailboxKey(r.email)) ?? 0) + 1);
  }
  for (const domain of domainCount.keys()) if (domain && !MAJOR_DOMAINS.has(domain)) verdict.set(domain, await mx(domain));

  const report: LegacyReport = {
    total: rows.length,
    byDay: [],
    ageGroup: { given: 0, none: 0 },
    activity: { loggedInAfterSignup: 0, openedAppSignedIn: 0, activeLast7Days: 0, neverActive: 0, withCourse: 0, withPlan: 0 },
    domains: { top: [], otherDomains: 0, otherAccounts: 0 },
    hygiene: { invalidSyntax: 0, roleAccount: 0, disposable: 0, sharedMailbox: 0, noMailServer: 0, lookupInconclusive: 0 },
    suppressed: 0,
    delivery: opts.history ? { addressesEmailed: 0, bounced: 0 } : null,
    rows: [],
  };
  for (const r of rows) {
    const [local = '', domain = ''] = r.email.toLowerCase().split('@');
    const day = new Date(r.created_ms).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (r.age_range) report.ageGroup.given++; else report.ageGroup.none++;
    if (r.logged_in) report.activity.loggedInAfterSignup++;
    if (r.opened) report.activity.openedAppSignedIn++;
    const lastDays = r.last_ms === null ? null : Math.floor((now.getTime() - r.last_ms) / 86_400_000);
    if (lastDays !== null && lastDays < 7) report.activity.activeLast7Days++;
    if (r.last_ms === null && !r.logged_in) report.activity.neverActive++;
    if (r.courses) report.activity.withCourse++;
    if (r.plans) report.activity.withPlan++;
    if (r.suppressed) report.suppressed++;
    const flags: string[] = [];
    if (!EMAIL_SHAPE.test(r.email)) flags.push('invalid_syntax');
    if (ROLE_LOCALPARTS.has(local.split('+')[0]!)) flags.push('role_account');
    if (DISPOSABLE_DOMAINS.has(domain)) flags.push('disposable_domain');
    if ((mailboxes.get(mailboxKey(r.email)) ?? 0) > 1) flags.push('shared_mailbox');
    const v = verdict.get(domain);
    if (v === 'none') flags.push('no_mail_server');
    if (v === 'unknown') flags.push('dns_inconclusive');
    const seen = opts.history?.byAddress.get(r.email.toLowerCase());
    if (seen && report.delivery) {
      report.delivery.addressesEmailed++;
      if (seen.bad) { report.delivery.bounced++; flags.push(`resend_${seen.bad}`); }
    }
    if (r.suppressed) flags.push('suppressed');
    for (const [flag, key] of [['invalid_syntax', 'invalidSyntax'], ['role_account', 'roleAccount'], ['disposable_domain', 'disposable'], ['shared_mailbox', 'sharedMailbox'], ['no_mail_server', 'noMailServer'], ['dns_inconclusive', 'lookupInconclusive']] as const)
      if (flags.includes(flag)) report.hygiene[key]++;
    report.rows.push({ masked: mask(r.email), day, domain: MAJOR_DOMAINS.has(domain) ? domain : '(other)', flags, signedIn: r.logged_in, lastActiveDaysAgo: lastDays, courses: r.courses, plans: r.plans });
  }
  report.byDay = [...byDay].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day));
  const major = [...domainCount].filter(([d]) => MAJOR_DOMAINS.has(d)).sort((a, b) => b[1] - a[1]);
  report.domains.top = major.map(([domain, n]) => ({ domain, n }));
  const other = [...domainCount].filter(([d]) => !MAJOR_DOMAINS.has(d));
  report.domains.otherDomains = other.length;
  report.domains.otherAccounts = other.reduce((n, [, c]) => n + c, 0);
  return report;
}

// ---------------------------------------------------------------- delivery status and results

/**
 * Reads each reminder's latest event back from Resend, and adds every address Resend recorded a bounce or complaint
 * for (any Exama email, including the sign-up email) to the suppression list, so no campaign or reminder emails it again.
 */
export async function syncReminders(opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ checked: number; updated: number; suppressed: number; historyEmails: number; stopped?: string }> {
  const synced = await syncDelivery({ ...opts, campaign: REMINDER_CAMPAIGN });
  let suppressed = synced.suppressed;
  let historyEmails = 0;
  let stopped = synced.stopped;
  try {
    const history = await fetchDeliveryHistory(opts);
    historyEmails = history.emails;
    const bad = [...history.byAddress].filter(([, v]) => v.bad === 'bounced' || v.bad === 'complained') as [string, { bad: 'bounced' | 'complained' }][];
    if (bad.length) {
      const known = await pg<{ email: string }[]>`select lower(email) as email from users where lower(email) = any(${bad.map(([a]) => a)}::text[])`;
      const mine = new Set(known.map((k) => k.email));
      for (const [address, v] of bad) {
        if (!mine.has(address)) continue;
        const [{ n }] = await pg<{ n: number }[]>`select count(*)::int as n from email_suppressions where email = ${address}`;
        if (n === 0) {
          await suppress(address, v.bad);
          suppressed++;
        }
      }
    }
    if (!history.complete) stopped ??= 'Resend log longer than the pages read: older bounces were not checked';
  } catch (err) {
    stopped ??= `could not read Resend's delivery log (${err instanceof Error ? err.message : 'error'})`;
  }
  return { checked: synced.checked, updated: synced.updated, suppressed, historyEmails, stopped };
}

export type ReminderReport = { sent: number; delivered: number; bounced: number; complained: number; confirmedAfter: number; stillUnverified: number };

/** Results so far: nobody is credited beyond "confirmed after the reminder"; there is no control group. */
export async function reminderReport(): Promise<ReminderReport> {
  const [r] = await pg<Record<string, number>[]>`
    select count(*)::int as sent,
      count(*) filter (where e.delivery_status in ('delivered', 'opened', 'clicked'))::int as delivered,
      count(*) filter (where e.delivery_status = 'bounced')::int as bounced,
      count(*) filter (where e.delivery_status = 'complained')::int as complained,
      count(*) filter (where u.email_verified_at is not null and u.email_verified_at > e.sent_at)::int as confirmed_after,
      count(*) filter (where u.email_verified_at is null)::int as still_unverified
    from email_campaign_sends e join users u on u.id = e.user_id
    where e.campaign like ${`${REMINDER_CAMPAIGN_PREFIX}%`} and e.status = 'sent'`;
  return { sent: r.sent, delivered: r.delivered, bounced: r.bounced, complained: r.complained, confirmedAfter: r.confirmed_after, stillUnverified: r.still_unverified };
}
