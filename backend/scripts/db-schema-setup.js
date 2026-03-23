/**
 * Aplica schema.sql, schema-extensions.sql e migrações SQL (.sql em db/migrations e backend/migrations).
 * Usado no start do container e por run-schema.js (sem espera).
 */

import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.join(__dirname, '..');
const dbDir = path.join(backendRoot, 'db');

function poolOptions(connectionString) {
  return { connectionString, ssl: false };
}

function splitSql(sql) {
  const statements = [];
  let current = '';
  let insideDollar = false;
  let i = 0;
  const s = sql.replace(/\r\n/g, '\n');

  while (i < s.length) {
    if (!insideDollar && s.slice(i, i + 2) === '$$') {
      current += s[i] + s[i + 1];
      i += 2;
      insideDollar = true;
      continue;
    }
    if (insideDollar && s.slice(i, i + 2) === '$$') {
      current += s[i] + s[i + 1];
      i += 2;
      insideDollar = false;
      continue;
    }
    if (!insideDollar && s[i] === ';') {
      const stmt = current.trim();
      const hasCode =
        stmt &&
        stmt.split('\n').some((line) => {
          const t = line.trim();
          return t && !t.startsWith('--');
        });
      if (hasCode) statements.push(stmt);
      current = '';
      i += 1;
      continue;
    }
    current += s[i];
    i += 1;
  }

  const last = current.trim();
  const lastHasCode =
    last &&
    last.split('\n').some((line) => {
      const t = line.trim();
      return t && !t.startsWith('--');
    });
  if (lastHasCode) statements.push(last);
  return statements;
}

async function runFile(pool, filePath, label) {
  const sql = readFileSync(filePath, 'utf8');
  const statements = splitSql(sql);
  for (let j = 0; j < statements.length; j++) {
    const stmt = statements[j];
    if (!stmt) continue;
    try {
      await pool.query(stmt);
    } catch (err) {
      console.error(`[db-setup] ${label} – statement ${j + 1}/${statements.length}:`, err.message);
      throw err;
    }
  }
}

function listMigrationFiles() {
  const dirs = [path.join(dbDir, 'migrations'), path.join(backendRoot, 'migrations')];
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.sql')) out.push(path.join(dir, name));
    }
  }
  out.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  return out;
}

async function waitForPostgres(pool, retries = 30, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('[DB] PostgreSQL conectado');
      return;
    } catch (err) {
      console.log(`[DB] aguardando PostgreSQL... tentativa ${i + 1}/${retries}`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  console.error('PostgreSQL não respondeu, backend continuará tentando após subir');
  return;
}

/**
 * @param {{ waitForPostgres?: boolean, bootstrapMode?: 'full' | 'safe' }} options
 * - waitForPostgres: aguardar o banco antes do bootstrap
 * - bootstrapMode:
 *   - full: aplica schema.sql + schema-extensions.sql + migrations
 *   - safe: não aplica schema base (evita DROP TABLE), aplica apenas migrations
 */
export async function setupDatabase(options = {}) {
  const { waitForPostgres: shouldWaitForPostgres = false } = options;
  const bootstrapMode = options.bootstrapMode === 'full' ? 'full' : 'safe';
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || String(connectionString).trim() === '') {
    console.error('[db-setup] DATABASE_URL não definida.');
    process.exit(1);
  }

  const pool = new pg.Pool(poolOptions(connectionString));

  try {
    if (shouldWaitForPostgres) {
      await waitForPostgres(pool);
    }

    console.log(`[db-setup] modo de bootstrap: ${bootstrapMode}`);
    if (bootstrapMode === 'full') {
      console.log('[db-setup] Aplicando schema.sql...');
      await runFile(pool, path.join(dbDir, 'schema.sql'), 'schema.sql');

      console.log('[db-setup] Aplicando schema-extensions.sql...');
      await runFile(pool, path.join(dbDir, 'schema-extensions.sql'), 'schema-extensions.sql');
    } else {
      console.log('[db-setup] modo safe: pulando schema.sql e schema-extensions.sql');
    }

    const migrations = listMigrationFiles();
    for (const file of migrations) {
      console.log(`[db-setup] Migração: ${path.basename(file)}`);
      await runFile(pool, file, path.basename(file));
    }

    console.log('[db-setup] Esquema e migrações aplicados.');
  } finally {
    await pool.end();
  }
}
