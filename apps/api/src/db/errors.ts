/** Turns common Postgres connection failures into actionable messages. */
export function explainDbError(err: unknown, databaseUrl: string): string {
  const e = err as { code?: string; message?: string; errors?: { code?: string }[] };
  const code = e.code ?? e.errors?.[0]?.code;
  let where = 'the database';
  try {
    const u = new URL(databaseUrl);
    where = `${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)} as user "${decodeURIComponent(u.username)}"`;
  } catch {
    return 'DATABASE_URL in apps/api/.env is not a valid URL (expected postgres://user:password@host:5432/dbname).';
  }
  switch (code) {
    case 'ECONNREFUSED':
      return `Cannot connect to Postgres at ${where}. Is Postgres running? (Docker: \`docker compose up -d\`; Windows installer: check the "postgresql" service is started.)`;
    case 'ENOTFOUND':
      return `Postgres host not found for ${where}. Check the host in DATABASE_URL.`;
    case '28P01':
    case '28000':
      return `Postgres rejected the username/password for ${where}. Fix the credentials in DATABASE_URL.`;
    case '3D000':
      return `Database does not exist (${where}). Run \`npm run db:migrate\` — it creates it automatically.`;
    default:
      return `Database error for ${where}: ${e.message ?? String(err)}`;
  }
}
