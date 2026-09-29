import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    // "mock" is the default so the app always runs without an API key.
    AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    ANTHROPIC_API_KEY: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // Only needed for API keys that are not scoped to a single workspace. Server-side only.
    ANTHROPIC_WORKSPACE_ID: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    AI_MODEL: z.string().trim().min(1).default('claude-sonnet-5'),
    STORAGE_DIR: z.string().default('./storage'),

    // ---- Billing ----
    // Owner accounts get permanent full access (no paywall, no trial, no expiry). Server-side only;
    // comma-separated. Matching is by the authenticated user's id or stored email — never by client input.
    OWNER_USER_IDS: csv,
    OWNER_EMAILS: csv.transform((list) => list.map((e) => e.toLowerCase())),
    // Development billing provider: lets any signed-in user start trials/subscriptions WITHOUT payment.
    // Never enable in production (the server refuses to start if NODE_ENV=production).
    BILLING_MOCK_ENABLED: z
      .enum(['true', 'false', ''])
      .optional()
      .transform((v) => v === 'true'),
    // Optional JSON to tune plan/trial limits without a code change, e.g. {"trial":{"practiceQuestionsPerMonth":5}}
    PLAN_LIMITS_OVERRIDE: z.string().optional(),
    // Optional JSON to switch plan features per tier without a code change, e.g. {"basic":{"lectures":true}}
    PLAN_FEATURES_OVERRIDE: z.string().optional(),
    // iOS bundle id; Apple transactions for any other app are rejected.
    APPLE_BUNDLE_ID: z.string().trim().min(1).default('com.exama.app'),
    // ---- App Store (iOS) ----
    // true = accept App Store purchases, verified with Apple's certificates (certs/apple).
    APPLE_IAP_ENABLED: z
      .enum(['true', 'false', ''])
      .optional()
      .transform((v) => v === 'true'),
    // The app's numeric Apple ID (App Store Connect → App Information → Apple ID). Needed to accept
    // Production purchases; without it only Sandbox (TestFlight / App Review) purchases are accepted.
    APPLE_APP_APPLE_ID: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? Number(v) : undefined))
      .pipe(z.number().int().positive().optional()),
    // Accept Sandbox purchases (TestFlight, App Review, sandbox testers). App Review needs this on.
    APPLE_ALLOW_SANDBOX: z
      .enum(['true', 'false', ''])
      .optional()
      .transform((v) => v !== 'false'),
    // Check Apple's certificates for revocation (OCSP, outbound HTTPS to Apple). Keep on in production.
    APPLE_ONLINE_CHECKS: z
      .enum(['true', 'false', ''])
      .optional()
      .transform((v) => v !== 'false'),
    // Directory with Apple's root certificates (.cer). Default: apps/api/certs/apple.
    APPLE_ROOT_CERTS_DIR: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // ---- Google Play Billing (Android) ----
    // Android package name; Play purchases for any other app are rejected.
    GOOGLE_PLAY_PACKAGE_NAME: z.string().trim().min(1).default('com.exama.app'),
    // Service-account key (JSON, or the same JSON base64-encoded) with access to the Play Developer
    // API ("View financial data" + "Manage orders and subscriptions"). Server-side only.
    // Empty = Google Play purchases are not accepted on this server.
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // Real-time developer notifications (Pub/Sub push to POST /billing/google/notifications):
    // the OIDC audience configured on the push subscription, and (recommended) its service account email.
    GOOGLE_PUBSUB_AUDIENCE: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    GOOGLE_PUBSUB_SERVICE_ACCOUNT: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // ---- Email (password-reset codes) ----
    // log = print emails to the server log (development only); resend = send with Resend (resend.com);
    // disabled = no email (password reset can't work). Unset: log in development, disabled in production.
    EMAIL_PROVIDER: z.enum(['log', 'resend', 'disabled']).optional(),
    RESEND_API_KEY: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // Sender, e.g. "Exama <no-reply@your-domain.com>" (the domain must be verified with the provider).
    EMAIL_FROM: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // Browser origins allowed to call the API (Expo web). Empty: any origin in development, none in production.
    // Native iOS/Android apps don't use CORS.
    CORS_ORIGINS: csv,
    NODE_ENV: z.string().optional(),
    MAX_UPLOAD_MB: z.coerce.number().default(20),

    // ---- Lecture audio/video (course materials) ----
    // mock = deterministic fake transcripts (no key, no cost; not allowed in production);
    // assemblyai = real transcription; disabled = PDFs only (audio/video uploads are refused).
    // Unset: mock in development, disabled in production.
    TRANSCRIPTION_PROVIDER: z.enum(['mock', 'assemblyai', 'disabled']).optional(),
    ASSEMBLYAI_API_KEY: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // EU data residency: https://api.eu.assemblyai.com (the key must belong to an EU project).
    ASSEMBLYAI_BASE_URL: z.url().default('https://api.assemblyai.com'),
    // Comma-separated, priority order. Universal-2 covers 99 languages (incl. Arabic).
    ASSEMBLYAI_SPEECH_MODELS: csv.transform((l) => (l.length ? l : ['universal-3-5-pro', 'universal-2'])),
    // Largest audio/video upload accepted (the stream is cut off beyond this).
    MEDIA_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2000).default(1024),
    // Server-wide hard cap on lecture length, whatever the plan says (owner included).
    MEDIA_MAX_MINUTES_PER_FILE: z.coerce.number().int().min(1).max(600).default(240),
    // Lectures processed at the same time by this server (transcription + extraction jobs).
    MEDIA_MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(20).default(2),
    // Unprocessed materials per student at once (more → "wait for your other lectures").
    MEDIA_MAX_ACTIVE_PER_USER: z.coerce.number().int().min(1).max(20).default(2),
    // Failed uploads keep their file for retries this long, then it is deleted.
    MEDIA_FAILED_RETENTION_DAYS: z.coerce.number().int().min(0).max(90).default(7),
    // Give up on a transcription after this long. Default: 10 min + half the lecture length.
    MEDIA_TRANSCRIPTION_TIMEOUT_SECONDS: z.coerce.number().int().min(1).optional(),
    // Uploads (and retries) per student per hour — burst protection on top of plan limits.
    MEDIA_UPLOADS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(20),
  })
  .superRefine((e, ctx) => {
    const production = e.NODE_ENV === 'production';
    if (production && e.AI_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'AI_PROVIDER=mock is not allowed when NODE_ENV=production (students would get fake questions). Set AI_PROVIDER=anthropic.',
      });
    }
    if (production && /change-me/i.test(e.JWT_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET still has the template value. Generate a new random secret for production.' });
    }
    if (e.BILLING_MOCK_ENABLED && production) {
      ctx.addIssue({
        code: 'custom',
        path: ['BILLING_MOCK_ENABLED'],
        message: 'BILLING_MOCK_ENABLED=true is not allowed when NODE_ENV=production (it grants premium without payment).',
      });
    }
    if (production && e.TRANSCRIPTION_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['TRANSCRIPTION_PROVIDER'],
        message:
          'TRANSCRIPTION_PROVIDER=mock is not allowed when NODE_ENV=production (lectures would get fake transcripts). Set TRANSCRIPTION_PROVIDER=assemblyai, or disabled.',
      });
    }
    if (e.TRANSCRIPTION_PROVIDER === 'assemblyai' && !e.ASSEMBLYAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ASSEMBLYAI_API_KEY'],
        message: 'TRANSCRIPTION_PROVIDER=assemblyai but ASSEMBLYAI_API_KEY is empty. Put your key in apps/api/.env, or set TRANSCRIPTION_PROVIDER=mock.',
      });
    }
    if (production && e.EMAIL_PROVIDER === 'log') {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'EMAIL_PROVIDER=log is not allowed when NODE_ENV=production (reset codes would only reach the server log).' });
    }
    if (e.EMAIL_PROVIDER === 'resend' && (!e.RESEND_API_KEY || !e.EMAIL_FROM)) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'EMAIL_PROVIDER=resend needs RESEND_API_KEY and EMAIL_FROM.' });
    }
    if (production && e.APPLE_IAP_ENABLED && !e.APPLE_APP_APPLE_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['APPLE_APP_APPLE_ID'],
        message: 'APPLE_IAP_ENABLED=true in production needs APPLE_APP_APPLE_ID (App Store Connect → App Information → Apple ID).',
      });
    }
    if (e.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON && !parseServiceAccount(e.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'],
        message: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must be the service-account key JSON (or base64 of it) with client_email and private_key.',
      });
    }
    if (e.AI_PROVIDER === 'anthropic' && !e.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message:
          'AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty. Put your key in apps/api/.env, or set AI_PROVIDER=mock.',
      });
    }
  });

export type GoogleServiceAccount = { client_email: string; private_key: string; token_uri?: string };

/** Accepts the key file's JSON or its base64 (easier to paste into hosting dashboards). */
export function parseServiceAccount(raw: string): GoogleServiceAccount | null {
  for (const text of [raw, Buffer.from(raw, 'base64').toString('utf8')]) {
    try {
      const v = JSON.parse(text) as Partial<GoogleServiceAccount>;
      if (typeof v.client_email === 'string' && typeof v.private_key === 'string' && v.private_key.includes('PRIVATE KEY')) {
        return { client_email: v.client_email, private_key: v.private_key, token_uri: v.token_uri };
      }
    } catch {
      /* try the next encoding */
    }
  }
  return null;
}

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('\n✖ Invalid server configuration (apps/api/.env):\n' + z.prettifyError(parsed.error));
    console.error('\nRun `npm run setup` to create apps/api/.env from the template, then edit it.\n');
    process.exit(1);
  }
  const cfg = {
    ...parsed.data,
    TRANSCRIPTION_PROVIDER: (parsed.data.TRANSCRIPTION_PROVIDER ?? (parsed.data.NODE_ENV === 'production' ? 'disabled' : 'mock')) as
      | 'mock'
      | 'assemblyai'
      | 'disabled',
    EMAIL_PROVIDER: (parsed.data.EMAIL_PROVIDER ?? (parsed.data.NODE_ENV === 'production' ? 'disabled' : 'log')) as 'log' | 'resend' | 'disabled',
  };
  if (cfg.EMAIL_PROVIDER === 'disabled') {
    console.warn('⚠ EMAIL_PROVIDER is disabled: password-reset emails are not sent. Set EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM.');
  }
  if (cfg.ANTHROPIC_API_KEY && !cfg.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    console.warn('⚠ ANTHROPIC_API_KEY does not start with "sk-ant-" — double-check you copied the whole key.');
  }
  if (cfg.AI_PROVIDER === 'mock' && cfg.ANTHROPIC_API_KEY) {
    console.warn('⚠ ANTHROPIC_API_KEY is set but AI_PROVIDER=mock, so the API uses the fake AI. Set AI_PROVIDER=anthropic in apps/api/.env to use Claude.');
  }
  if (cfg.ANTHROPIC_WORKSPACE_ID && !cfg.ANTHROPIC_WORKSPACE_ID.startsWith('wrkspc_')) {
    console.warn('⚠ ANTHROPIC_WORKSPACE_ID does not start with "wrkspc_" — copy the ID from Console → Settings → Workspaces.');
  }
  return cfg;
}

export const config = loadConfig();

/** Safe-to-share description of the active AI setup (never includes the key or workspace ID). */
export const aiInfo = {
  provider: config.AI_PROVIDER,
  model: config.AI_PROVIDER === 'mock' ? 'mock' : config.AI_MODEL,
};

/** Safe-to-share transcription setup (never includes the key). */
export const transcriptionInfo = { provider: config.TRANSCRIPTION_PROVIDER };
