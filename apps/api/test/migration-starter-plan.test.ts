// Migration 0027 (Starter plan): the organizations_plan_check constraint accepts 'starter'.
//
// Checked on a FRESH database (all migrations in order) and on an EXISTING, populated database (migrated up to 0026,
// organizations on every plan inserted, then upgraded): no row changes, every plan is kept, the default stays 'none',
// 'starter' is accepted after the migration and refused before it, unknown plans are still refused, and running the
// migrations again is a no-op.
//
// Same temporary-database pattern as marketing-consent.test.ts (migration 0021).
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const RUN = Date.now();
let n = 0;

const { config } = await import('../src/config.js');
const postgresModule = await import('postgres');
const { drizzle } = await import('drizzle-orm/postgres-js');
const { migrate } = await import('drizzle-orm/postgres-js/migrator');
const DRIZZLE = new URL('../drizzle/', import.meta.url).pathname;
const TAG = '0027_organization_starter_plan';

type Sql = ReturnType<typeof postgresModule.default>;

async function withTempDatabase(run: (connect: () => Sql) => Promise<void>) {
  const name = `migstarter_${RUN}_${++n}`;
  const adminUrl = new URL(config.DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = postgresModule.default(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(config.DATABASE_URL);
  url.pathname = `/${name}`;
  const clients: Sql[] = [];
  try {
    await run(() => {
      const c = postgresModule.default(url.toString(), { max: 1, onnotice: () => {} });
      clients.push(c);
      return c;
    });
  } finally {
    await Promise.all(clients.map((c) => c.end()));
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}

const planCheck = async (db: Sql) => (await db<{ def: string }[]>`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'organizations_plan_check'`)[0]?.def ?? null;

async function insertOrg(db: Sql, name: string, plan: string) {
  return db`insert into organizations (name, market, plan) values (${name}, 'training_center', ${plan})`;
}

async function assertUpgraded(db: Sql) {
  const def = await planCheck(db);
  assert.ok(def && ['none', 'pilot', 'starter', 'esencial', 'profesional', 'centro'].every((p) => def.includes(`'${p}'`)), `constraint accepts every plan: ${def}`);
  assert.equal((await db<{ d: string }[]>`select column_default as d from information_schema.columns where table_name = 'organizations' and column_name = 'plan'`)[0]!.d, "'none'::text", 'default plan still none');
  await insertOrg(db, 'Starter org', 'starter');
  await assert.rejects(insertOrg(db, 'Unknown plan', 'enterprise'), /organizations_plan_check/, 'unknown plans are still refused');
}

test(`migration ${TAG} on a FRESH database: all migrations apply in order and 'starter' is accepted`, async () => {
  const journal = JSON.parse(await readFile(join(DRIZZLE, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  assert.equal(journal.entries.findIndex((e) => e.tag === TAG), journal.entries.findIndex((e) => e.tag === '0026_organization_no_default_plan') + 1, '0027 follows 0026 in the journal');
  await withTempDatabase(async (connect) => {
    const db = connect();
    await migrate(drizzle(db), { migrationsFolder: DRIZZLE });
    assert.equal((await db`select count(*)::int as n from drizzle.__drizzle_migrations`)[0]!.n, journal.entries.length);
    await assertUpgraded(db);
    assert.equal((await db<{ plan: string }[]>`select plan from organizations where name = 'Starter org'`)[0]!.plan, 'starter');
  });
});

test(`migration ${TAG} on an EXISTING, populated database: every organization keeps its plan, 'starter' becomes accepted`, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'exama-migrations-starter-'));
  try {
    // The migrations as they are in production before this release: everything up to 0026.
    await cp(DRIZZLE, folder, { recursive: true });
    const journalPath = join(folder, 'meta/_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string; idx: number }[] };
    const first = journal.entries.find((e) => e.tag === TAG)!;
    for (const e of journal.entries.filter((e) => e.idx >= first.idx)) {
      await rm(join(folder, `${e.tag}.sql`));
      await rm(join(folder, `meta/${e.tag.slice(0, 4)}_snapshot.json`));
    }
    journal.entries = journal.entries.filter((e) => e.idx < first.idx);
    await writeFile(journalPath, JSON.stringify(journal));

    await withTempDatabase(async (connect) => {
      const db = connect();
      await migrate(drizzle(db), { migrationsFolder: folder });
      const before = await planCheck(db);
      assert.ok(before && !before.includes("'starter'"), `the "before" constraint does not know starter: ${before}`);
      await assert.rejects(insertOrg(db, 'Too early', 'starter'), /organizations_plan_check/, "'starter' is refused before the migration");

      // A populated database: one organization on every plan, including a running pilot and custom Centro limits.
      await db`insert into organizations (name, market, plan, billing_period, limits, pilot_started_at, pilot_ends_at) values
        ('No plan yet', 'training_center', 'none', null, '{}', '2026-10-01T10:00:00Z', null),
        ('Pilot org', 'training_provider', 'pilot', null, '{}', '2026-10-20T10:00:00Z', '2026-11-03T10:00:00Z'),
        ('Essential org', 'university', 'esencial', 'monthly', '{}', '2026-09-01T10:00:00Z', null),
        ('Professional org', 'corporate', 'profesional', 'yearly', '{}', '2026-08-01T10:00:00Z', null),
        ('Centro org', 'school', 'centro', 'yearly', '{"itemsPerMonth": 5000, "maxMembers": 60}', '2026-07-01T10:00:00Z', null)`;
      const snapshot = () => db`select id, name, market, plan, billing_period, limits::text as limits, pilot_started_at::text as started, pilot_ends_at::text as ends, created_at::text as created, updated_at::text as updated from organizations order by name`.then((rows) => rows.map((r) => ({ ...r })));
      const rowsBefore = await snapshot();
      assert.equal(rowsBefore.length, 5);

      await migrate(drizzle(db), { migrationsFolder: DRIZZLE }); // the upgrade: 0027
      assert.deepEqual(await snapshot(), rowsBefore, 'no existing row is changed');
      await assertUpgraded(db);
      // The old shape of an insert (no plan given) still works and still gets 'none'.
      await db`insert into organizations (name, market) values ('Signed up after the release', 'other')`;
      assert.equal((await db<{ plan: string }[]>`select plan from organizations where name = 'Signed up after the release'`)[0]!.plan, 'none');
      // Running the migrations again is a no-op.
      await migrate(drizzle(db), { migrationsFolder: DRIZZLE });
      assert.equal((await db`select count(*)::int as n from organizations`)[0]!.n, 7);
      assert.equal((await db`select count(*)::int as n from drizzle.__drizzle_migrations`)[0]!.n, first.idx + 1);
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
