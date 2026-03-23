/**
 * Entrypoint antes do server: espera Postgres e aplica SQL (Docker / reset de volume).
 */
import { setupDatabase } from './db-schema-setup.js';

const mode = process.env.DB_BOOTSTRAP_MODE || 'safe';
await setupDatabase({
  waitForPostgres: true,
  bootstrapMode: mode === 'full' ? 'full' : 'safe',
});
