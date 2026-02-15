/**
 * Aplica schema-agent-users.sql e opcionalmente insere usuário padrão (AGENTE IA OMNICANAL).
 * Uso: node scripts/run-agent-schema.js [senha]
 * Sem senha: só cria a tabela. Com senha: cria tabela e insere admin@exemplo.com / senha informada.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, '..', 'db');

async function main() {
  if (!config.databaseUrl) {
    console.error('Defina DATABASE_URL no .env');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  const sql = readFileSync(join(dbDir, 'schema-agent-users.sql'), 'utf8');
  const statements = sql.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith('--'));
  for (const stmt of statements) {
    if (stmt) {
      await client.query(stmt);
      console.log('[run-agent-schema] Executado:', stmt.slice(0, 50) + '...');
    }
  }

  const password = process.argv[2];
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO agent_users (name, email, password, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password`,
      ['Administrador', 'admin@exemplo.com', hash, 'admin']
    );
    console.log('[run-agent-schema] Usuário admin@exemplo.com criado/atualizado.');
  }

  await client.end();
  console.log('[run-agent-schema] Concluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
