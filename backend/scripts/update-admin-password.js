/**
 * Atualiza a senha do admin no banco (Neon).
 * Uso: node scripts/update-admin-password.js [senha]
 * Padrão: admin123
 * Execute após run-schema.js se o login retornar "Email ou senha inválidos".
 */

import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';
import { query, getPool } from '../db/connection.js';

const password = process.argv[2] || 'admin123';
const email = 'admin@exemplo.com';

async function run() {
  const pool = getPool();
  if (!pool) {
    console.error('[update-admin-password] DATABASE_URL não definida no .env.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  const { rowCount } = await query(
    "UPDATE admins SET password_hash = $1 WHERE email = $2",
    [hash, email]
  );
  if (rowCount === 0) {
    console.error('[update-admin-password] Nenhum admin com email', email, '- rode run-schema.js antes.');
    process.exit(1);
  }
  console.log('[update-admin-password] Senha do admin atualizada. Use', email, '/', password, 'para login.');
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
