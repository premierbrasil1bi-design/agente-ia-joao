import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query } from '../db/connection.js';

async function updatePassword() {
  try {
    const email = process.argv[2];
    const password = process.argv[3];

    if (!email || !password) {
      console.log('Uso correto:');
      console.log('node scripts/update-admin-password.js email novaSenha');
      process.exit(1);
    }

    console.log('Gerando hash bcrypt...');
    const hash = await bcrypt.hash(password, 10);

    const result = await query(
      'UPDATE global_admins SET password_hash = $1 WHERE email = $2 RETURNING id, email',
      [hash, email]
    );

    if (result.rowCount === 0) {
      console.log('Admin não encontrado.');
      process.exit(1);
    }

    console.log('Senha atualizada com sucesso para:', result.rows[0].email);
    process.exit(0);

  } catch (error) {
    console.error('Erro ao atualizar senha:', error);
    process.exit(1);
  }
}

updatePassword();
