/**
 * Cria ou atualiza o usuário admin@exemplo.com em agent_users (AGENTE IA OMNICANAL).
 * Uso: node scripts/seed-agent-user.js
 *      node scripts/seed-agent-user.js minha_senha
 * Senha padrão se não informada: admin123
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';

const DEFAULT_PASSWORD = 'admin123';
const EMAIL = 'admin@exemplo.com';
const NAME = 'Administrador';
const ROLE = 'admin';

async function main() {
  if (!config.databaseUrl) {
    console.error('Defina DATABASE_URL no .env');
    process.exit(1);
  }

  const password = process.argv[2] || DEFAULT_PASSWORD;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const exists = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_users'"
    );
    if (exists.rows.length === 0) {
      console.error('Tabela agent_users não existe. Rode antes: node scripts/run-agent-schema.js', password);
      process.exit(1);
    }

    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO agent_users (name, email, password, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, name = EXCLUDED.name`,
      [NAME, EMAIL, hash, ROLE]
    );
    console.log('[seed-agent-user] Usuário criado/atualizado.');
    console.log('  Email:', EMAIL);
    console.log('  Senha:', password);
    console.log('Use essas credenciais na tela de login.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
