/**
 * Applies SQL migrations. If the database in DATABASE_URL doesn't exist yet
 * (typical with a fresh Windows Postgres install), it is created first.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { config } from '../config.js';
import { explainDbError } from './errors.js';

const url = config.DATABASE_URL;

async function ensureDatabaseExists() {
  const probe = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    await probe`select 1`;
  } catch (err) {
    if ((err as { code?: string }).code !== '3D000') throw err;
    const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
    const adminUrl = new URL(url);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`✓ Created database "${dbName}"`);
    } finally {
      await admin.end();
    }
  } finally {
    await probe.end();
  }
}

try {
  await ensureDatabaseExists();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  await sql.end();
  console.log('✓ Migrations applied');
} catch (err) {
  console.error('✖ ' + explainDbError(err, url));
  process.exit(1);
}
