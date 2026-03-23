/**
 * Cliente PostgreSQL – conexão única reutilizável.
 * Usa DATABASE_URL do ambiente.
 */

import pg from 'pg';

const { Pool } = pg;

let pool = null;

/**
 * Retorna o pool de conexões. Cria uma vez e reutiliza.
 * @returns {pg.Pool}
 */
export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL não definida no ambiente.');
    }
    pool = new Pool({
      connectionString,
      ssl: false,
    });
  }
  return pool;
}

/**
 * Executa uma query e retorna as linhas.
 * @param {string} text - SQL
 * @param {Array} [params] - Parâmetros
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
  const p = getPool();
  return p.query(text, params);
}

/**
 * Fecha o pool (útil para testes ou shutdown).
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
