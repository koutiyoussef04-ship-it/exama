// Cross-platform first-time setup (Windows/macOS/Linux): creates apps/api/.env from the template
// with a random JWT_SECRET. Safe to re-run: never overwrites an existing .env.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const example = join(root, 'apps', 'api', '.env.example');
const target = join(root, 'apps', 'api', '.env');

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`✖ Node ${process.versions.node} detected. Please install Node 22 LTS or newer: https://nodejs.org`);
  process.exit(1);
}

if (existsSync(target)) {
  console.log(`✓ ${target} already exists — left unchanged.`);
} else {
  const secret = randomBytes(32).toString('hex');
  const content = readFileSync(example, 'utf8').replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`);
  writeFileSync(target, content);
  console.log(`✓ Created ${target} (with a random JWT_SECRET).`);
}

console.log(`
Next:
  1. Make sure Postgres is running and DATABASE_URL in apps/api/.env points to it.
  2. npm run db:migrate
  3. npm run dev:api        (then open http://localhost:4000/health)
  4. npm run dev:mobile     (in a second terminal)
To use real AI: set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY=... in apps/api/.env, then run  npm run ai:check
`);
