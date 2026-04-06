/**
 * API de query e health — usa o mesmo pool que `pool.js` (evita duas conexões divergentes).
 */

import { pool } from './pool.js';

export async function query(text, params) {
  return pool.query(text, params);
}

export function getPool() {
  return pool;
}

export async function isDbConnected() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('Erro real ao conectar no banco:', err.message);
    return false;
  }
}

/* Alias para manter compatibilidade com código antigo */
export const isConnected = isDbConnected;

export async function closePool() {
  await pool.end();
}

export default pool;
