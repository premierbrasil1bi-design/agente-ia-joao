import { pool } from '../db/pool.js';

/**
 * Verificação leve no startup: channels.connection_status obrigatório; evolution_status não deve existir.
 * Não encerra o processo (evita derrubar produção por drift transitório); apenas loga com [SCHEMA_GUARD].
 */
export async function runChannelsSchemaGuard() {
  try {
    const { rows } = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'channels'
        AND column_name IN ('connection_status', 'evolution_status')
    `);
    const names = new Set(rows.map((r) => r.column_name));

    if (!names.has('connection_status')) {
      console.error(
        '[SCHEMA_GUARD] Falta channels.connection_status. Aplique db/migrations/010_channels_connection_status.sql (e 013 se ainda houver evolution_status legada).'
      );
      return;
    }

    if (names.has('evolution_status')) {
      console.warn(
        '[SCHEMA_GUARD] Coluna channels.evolution_status ainda existe no schema. O código OMNIA não usa mais essa coluna; rode db/migrations/013_drop_legacy_evolution_status_guards.sql para alinhar.'
      );
    }
  } catch (e) {
    console.warn('[SCHEMA_GUARD] Verificação de schema (channels) ignorada:', e?.message || e);
  }
}
