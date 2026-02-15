/**
 * Gera hash bcrypt para a senha do admin inicial.
 * Uso: node scripts/gen-admin-hash.js
 * Senha padrão: admin123
 */
import bcrypt from 'bcryptjs';
const password = process.argv[2] || 'admin123';
const hash = await bcrypt.hash(password, 10);
console.log('Senha:', password);
console.log('Hash (use no schema-admins.sql ou UPDATE admins):', hash);
