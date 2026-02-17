/**
 * Executa schema.sql e schema-extensions.sql no banco Neon (DATABASE_URL do .env).
 * Ordem: 1) schema.sql  2) schema-extensions.sql
 * Uso: node scripts/run-schema.js
 * Executar ANTES do seed: node scripts/seed-dashboard.js
 */


import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.join(__dirname, '..');
const dbDir = path.join(backendRoot, 'db');

/**
 * Divide SQL em statements (respeitando $$ ... $$ para funções).
 */
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
      const hasCode = stmt && stmt.split('\n').some((line) => {
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
  const lastHasCode = last && last.split('\n').some((line) => {
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
      console.error(`[run-schema] ${label} – statement ${j + 1}/${statements.length}:`, err.message);
      throw err;
    }
  }
}

async function run() {
  const connectionString = config.databaseUrl;
  if (!connectionString) {
    console.error('[run-schema] DATABASE_URL não definida no .env. Configure e tente novamente.');
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: config.isProduction ? { rejectUnauthorized: true } : false,
  });

  try {
    console.log('[run-schema] Aplicando schema.sql...');
    await runFile(pool, join(dbDir, 'schema.sql'), 'schema.sql');
    console.log('[run-schema] schema.sql aplicado.');

    console.log('[run-schema] Aplicando schema-extensions.sql...');
    await runFile(pool, join(dbDir, 'schema-extensions.sql'), 'schema-extensions.sql');
    console.log('[run-schema] schema-extensions.sql aplicado.');

    console.log('[run-schema] Concluído. Pode rodar o seed: node scripts/seed-dashboard.js');
  } catch (err) {
    console.error('[run-schema] Erro:', err.message);
    if (err.code === '42P01') {
      console.error('[run-schema] Tabela referenciada não existe. Verifique se schema.sql foi aplicado antes de schema-extensions.sql.');
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
