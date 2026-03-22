/**
 * Executa schema.sql, schema-extensions.sql e migrações (DATABASE_URL no .env).
 * Uso: node scripts/run-schema.js
 */
import { setupDatabase } from './db-schema-setup.js';

try {
  await setupDatabase({ waitForPostgres: false });
  console.log('[run-schema] Concluído.');
} catch (err) {
  console.error('[run-schema] Erro:', err.message);
  process.exit(1);
}
