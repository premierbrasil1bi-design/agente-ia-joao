/**
 * URL e opções do pool PostgreSQL (Docker: saas_postgres:5432; fallback quando DATABASE_URL ausente).
 */

export function maskDatabaseUrl(url) {
  return String(url).replace(/:[^:@]+@/, ':**@');
}

export function resolveDatabaseUrl() {
  const explicit = process.env.DATABASE_URL?.trim();
  if (explicit) return explicit;
  console.warn('[DB] DATABASE_URL ausente — usando fallback saas_postgres:5432/postgres');
  const pwd = encodeURIComponent(process.env.POSTGRES_PASSWORD || 'postgres');
  return `postgresql://postgres:${pwd}@saas_postgres:5432/postgres`;
}

/**
 * @param {string} connectionString
 * @returns {{ connectionString: string, ssl?: { rejectUnauthorized: boolean } }}
 */
export function buildPoolOptions(connectionString) {
  let useSsl = true;
  try {
    const u = new URL(connectionString);
    const h = (u.hostname || '').toLowerCase();
    if (h === 'saas_postgres' || h === 'localhost' || h === '127.0.0.1') {
      useSsl = false;
    }
  } catch {
    /* mantém SSL */
  }

  const opts = { connectionString };
  if (useSsl) {
    opts.ssl = { rejectUnauthorized: false };
  }
  return opts;
}
