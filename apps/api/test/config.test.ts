/** Startup configuration: mock is the default; real AI without a key fails fast and clearly. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./helpers/print-config.ts', import.meta.url));
const billingScript = fileURLToPath(new URL('./helpers/print-billing.ts', import.meta.url));
const transcriptionScript = fileURLToPath(new URL('./helpers/print-transcription.ts', import.meta.url));

function loadConfigWith(overrides: Record<string, string | undefined>, file = script) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    AI_PROVIDER: undefined,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_WORKSPACE_ID: undefined,
    AI_MODEL: undefined,
    BILLING_MOCK_ENABLED: undefined,
    PLAN_LIMITS_OVERRIDE: undefined,
    PLAN_FEATURES_OVERRIDE: undefined,
    OWNER_EMAILS: undefined,
    OWNER_USER_IDS: undefined,
    NODE_ENV: undefined,
    TRANSCRIPTION_PROVIDER: undefined,
    ASSEMBLYAI_API_KEY: undefined,
    MEDIA_MAX_UPLOAD_MB: undefined,
    MEDIA_MAX_MINUTES_PER_FILE: undefined,
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: undefined,
    GOOGLE_PUBSUB_AUDIENCE: undefined,
    GOOGLE_PUBSUB_SERVICE_ACCOUNT: undefined,
    APPLE_IAP_ENABLED: undefined,
    APPLE_APP_APPLE_ID: undefined,
    APPLE_ALLOW_SANDBOX: undefined,
    APPLE_ONLINE_CHECKS: undefined,
    APPLE_ROOT_CERTS_DIR: undefined,
    EMAIL_PROVIDER: undefined,
    RESEND_API_KEY: undefined,
    EMAIL_FROM: undefined,
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(40),
    ...overrides,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const r = spawnSync(process.execPath, ['--import', 'tsx', file], { env: env as NodeJS.ProcessEnv, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('defaults to the mock AI when AI_PROVIDER is not set', () => {
  const r = loadConfigWith({});
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { provider: 'mock', model: 'mock' });
});

test('AI_PROVIDER=anthropic without a key refuses to start with a clear message', () => {
  for (const key of [undefined, '', '   ']) {
    const r = loadConfigWith({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: key });
    assert.equal(r.code, 1);
    assert.match(r.err, /ANTHROPIC_API_KEY is empty/);
    assert.match(r.err, /apps\/api\/\.env/);
  }
});

test('AI_PROVIDER=anthropic with a key reports provider and model, never the key', () => {
  const r = loadConfigWith({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test-SECRET', AI_MODEL: 'claude-x' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { provider: 'anthropic', model: 'claude-x' });
  assert.ok(!r.out.includes('SECRET') && !r.err.includes('SECRET'));
});

test('invalid AI_PROVIDER is rejected', () => {
  const r = loadConfigWith({ AI_PROVIDER: 'openai' });
  assert.equal(r.code, 1);
  assert.match(r.err, /AI_PROVIDER/);
});

test('ANTHROPIC_WORKSPACE_ID is optional and never reported by /health info', () => {
  const without = loadConfigWith({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' });
  assert.equal(without.code, 0, without.err);
  const withWs = loadConfigWith({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_WORKSPACE_ID: 'wrkspc_01SECRETWS' });
  assert.equal(withWs.code, 0, withWs.err);
  assert.ok(!withWs.out.includes('wrkspc_01SECRETWS'));
  assert.ok(!withWs.err.includes('does not start with'), 'valid ID should not warn');
  const typo = loadConfigWith({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_WORKSPACE_ID: 'my-workspace' });
  assert.equal(typo.code, 0);
  assert.match(typo.err, /ANTHROPIC_WORKSPACE_ID does not start with "wrkspc_"/);
});

test('warns when a key is configured but AI_PROVIDER is still mock', () => {
  const r = loadConfigWith({ AI_PROVIDER: 'mock', ANTHROPIC_API_KEY: 'sk-ant-test-SECRET' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /AI_PROVIDER=mock, so the API uses the fake AI/);
  assert.ok(!r.err.includes('SECRET'));
  const quiet = loadConfigWith({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' });
  assert.ok(!quiet.err.includes('fake AI'));
});

test('billing: purchases are off unless the mock is explicitly enabled', () => {
  const off = loadConfigWith({}, billingScript);
  assert.equal(off.code, 0, off.err);
  assert.equal(JSON.parse(off.out).provider, null);
  const on = loadConfigWith({ BILLING_MOCK_ENABLED: 'true' }, billingScript);
  assert.equal(JSON.parse(on.out).provider, 'mock');
});

test('billing: Google Play is enabled only by a valid service account; the key is never printed', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const sa = JSON.stringify({ type: 'service_account', client_email: 'play@exama-test.iam.gserviceaccount.com', private_key: pem });

  const off = loadConfigWith({}, billingScript);
  assert.deepEqual(JSON.parse(off.out).platforms, { ios: null, android: null, web: null });

  for (const value of [sa, Buffer.from(sa).toString('base64')]) {
    const on = loadConfigWith({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: value }, billingScript);
    assert.equal(on.code, 0, on.err);
    const out = JSON.parse(on.out);
    assert.deepEqual(out.stores, ['google']);
    assert.deepEqual(out.platforms, { ios: null, android: 'google', web: null }, 'Android sells via Google Play; web never sells');
    assert.equal(out.provider, null, 'older iOS builds (no platform) never get the Google store');
  }

  const bad = loadConfigWith({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{"client_email":"x"}' }, billingScript);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must be the service-account key/);
  assert.ok(!bad.err.includes('client_email":"x'), 'the value is not echoed');

  // Development mock wins on every platform (and is still refused in production, see below).
  const mock = loadConfigWith({ BILLING_MOCK_ENABLED: 'true', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: sa }, billingScript);
  assert.deepEqual(JSON.parse(mock.out).platforms, { ios: 'mock', android: 'mock', web: 'mock' });
  for (const r of [off, bad, mock]) assert.ok(!r.out.includes('PRIVATE KEY') && !r.err.includes('PRIVATE KEY'));
});

test('billing: plan features per tier are configurable server-side and validated', () => {
  const def = JSON.parse(loadConfigWith({}, billingScript).out);
  assert.deepEqual(def.features.basic, { lectures: false, adaptivePractice: false, weakTopicAnalysis: false, adaptivePlanner: false });
  assert.deepEqual(def.features.trial, { lectures: true, adaptivePractice: true, weakTopicAnalysis: true, adaptivePlanner: true });
  assert.deepEqual([def.limits.basic.mediaMinutesPerMonth, def.limits.pro.mediaMinutesPerMonth], [0, 720]);

  const on = loadConfigWith({ PLAN_FEATURES_OVERRIDE: '{"basic":{"weakTopicAnalysis":true}}' }, billingScript);
  assert.equal(on.code, 0, on.err);
  assert.deepEqual(JSON.parse(on.out).features.basic, { lectures: false, adaptivePractice: false, weakTopicAnalysis: true, adaptivePlanner: false });
  for (const bad of ['{"basic":{"lecturez":true}}', '{"gold":{"lectures":true}}', '{"basic":{"lectures":"yes"}}', 'not json']) {
    const r = loadConfigWith({ PLAN_FEATURES_OVERRIDE: bad }, billingScript);
    assert.notEqual(r.code, 0, bad);
    assert.match(r.err, /PLAN_FEATURES_OVERRIDE/);
  }
  const basicLimits = loadConfigWith({ PLAN_LIMITS_OVERRIDE: '{"basic":{"courses":12}}' }, billingScript);
  assert.equal(JSON.parse(basicLimits.out).limits.basic.courses, 12);
});

test('billing: the mock provider can never run in production', () => {
  const r = loadConfigWith({ BILLING_MOCK_ENABLED: 'true', NODE_ENV: 'production' }, billingScript);
  assert.equal(r.code, 1);
  assert.match(r.err, /not allowed when NODE_ENV=production/);
});

test('billing: plan limits are configurable server-side and validated', () => {
  const r = loadConfigWith({ PLAN_LIMITS_OVERRIDE: '{"free":{"examGenerationsPerMonth":5},"pro":{"courses":null},"trial":{"practiceQuestionsPerMonth":10}}' }, billingScript);
  assert.equal(r.code, 0, r.err);
  const { limits } = JSON.parse(r.out);
  assert.equal(limits.free.examGenerationsPerMonth, 5);
  assert.equal(limits.free.courses, 1, 'untouched values keep their defaults');
  assert.equal(limits.pro.courses, null);
  assert.equal(limits.trial.practiceQuestionsPerMonth, 10, 'trial limits are configurable too');
  assert.equal(limits.trial.examGenerationsPerMonth, 3);
  const bad = loadConfigWith({ PLAN_LIMITS_OVERRIDE: '{"free":{"coursez":2}}' }, billingScript);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /unknown limit "free.coursez"/);
});

test('production: refuses mock AI, mock billing and the template JWT secret; a real setup starts', () => {
  const prod = { NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test', JWT_SECRET: 'p'.repeat(48) };
  const ok = loadConfigWith(prod, billingScript);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(JSON.parse(ok.out).provider, null, 'no App Store purchases until APPLE_IAP_ENABLED=true — never the mock');

  const mockAi = loadConfigWith({ ...prod, AI_PROVIDER: 'mock' });
  assert.equal(mockAi.code, 1);
  assert.match(mockAi.err, /AI_PROVIDER=mock is not allowed when NODE_ENV=production/);

  const mockBilling = loadConfigWith({ ...prod, BILLING_MOCK_ENABLED: 'true' }, billingScript);
  assert.equal(mockBilling.code, 1);
  assert.match(mockBilling.err, /BILLING_MOCK_ENABLED=true is not allowed/);

  const template = loadConfigWith({ ...prod, JWT_SECRET: 'change-me-to-a-long-random-string-at-least-32-chars' });
  assert.equal(template.code, 1);
  assert.match(template.err, /JWT_SECRET still has the template value/);
});

test('lecture transcription: mock in development, never in production; a real provider needs its key', () => {
  const dev = loadConfigWith({}, transcriptionScript);
  assert.equal(dev.code, 0, dev.err);
  assert.deepEqual(JSON.parse(dev.out), { provider: 'mock', maxMinutesPerFile: 240, maxUploadMb: 1024 });

  const prod = { NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test', JWT_SECRET: 'p'.repeat(48) };
  const unset = loadConfigWith(prod, transcriptionScript);
  assert.equal(unset.code, 0, unset.err);
  assert.equal(JSON.parse(unset.out).provider, 'disabled', 'production without a provider: PDFs only, never fake transcripts');

  const mock = loadConfigWith({ ...prod, TRANSCRIPTION_PROVIDER: 'mock' }, transcriptionScript);
  assert.equal(mock.code, 1);
  assert.match(mock.err, /TRANSCRIPTION_PROVIDER=mock is not allowed when NODE_ENV=production/);

  const noKey = loadConfigWith({ TRANSCRIPTION_PROVIDER: 'assemblyai' }, transcriptionScript);
  assert.equal(noKey.code, 1);
  assert.match(noKey.err, /ASSEMBLYAI_API_KEY is empty/);

  const real = loadConfigWith({ ...prod, TRANSCRIPTION_PROVIDER: 'assemblyai', ASSEMBLYAI_API_KEY: 'aai-test' }, transcriptionScript);
  assert.equal(real.code, 0, real.err);
  assert.equal(JSON.parse(real.out).provider, 'assemblyai');
  assert.ok(!real.out.includes('aai-test'), 'the key is never printed');

  const capped = loadConfigWith({ MEDIA_MAX_MINUTES_PER_FILE: '90', PLAN_LIMITS_OVERRIDE: '{"pro":{"maxMediaMinutesPerFile":500}}' }, billingScript);
  assert.equal(capped.code, 0, capped.err);
  assert.equal(JSON.parse(capped.out).limits.pro.maxMediaMinutesPerFile, 90, 'no plan can exceed the server-wide lecture cap');
});

test('App Store: needs APPLE_APP_APPLE_ID in production; once set, iOS purchases go to Apple', () => {
  const prod = { NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test', JWT_SECRET: 'p'.repeat(48), APPLE_IAP_ENABLED: 'true' };
  const missing = loadConfigWith(prod, billingScript);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /APPLE_APP_APPLE_ID/);
  const ok = loadConfigWith({ ...prod, APPLE_APP_APPLE_ID: '1234567890' }, billingScript);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(JSON.parse(ok.out).platforms, { ios: 'apple', android: null, web: null });
  const bad = loadConfigWith({ ...prod, APPLE_APP_APPLE_ID: 'abc' }, billingScript);
  assert.notEqual(bad.code, 0);
});

test('email: log provider refused in production; resend needs a key and a sender', () => {
  const prod = { NODE_ENV: 'production', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test', JWT_SECRET: 'p'.repeat(48) };
  const log = loadConfigWith({ ...prod, EMAIL_PROVIDER: 'log' });
  assert.equal(log.code, 1);
  assert.match(log.err, /EMAIL_PROVIDER=log is not allowed/);
  const resend = loadConfigWith({ EMAIL_PROVIDER: 'resend' });
  assert.equal(resend.code, 1);
  assert.match(resend.err, /RESEND_API_KEY and EMAIL_FROM/);
  const unset = loadConfigWith(prod);
  assert.equal(unset.code, 0, unset.err);
  assert.match(unset.err, /EMAIL_PROVIDER is disabled/, 'production without email warns loudly');
});
