/**
 * Cliente PostgreSQL – conexão única reutilizável (mesmo pool que pool.js).
 */

import { pool } from './pool.js';

/**
 * @returns {import('pg').Pool}
 */
export function getPool() {
  return pool;
}

/**
 * @param {string} text - SQL
 * @param {Array} [params] - Parâmetros
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, params = []) {
  return pool.query(text, params);
}

/**
 * Fecha o pool (útil para testes ou shutdown).
 */
export async function closePool() {
  await pool.end();
}
