/**
 * Entrypoint antes do server: espera Postgres e aplica SQL (Docker / reset de volume).
 */
import { setupDatabase } from './db-schema-setup.js';

await setupDatabase({
  waitForPostgres: true,
});
