/**
 * Conexão Neon (PostgreSQL) – pool único.
 * Usa config (DATABASE_URL). Se ausente: getPool() retorna null e log de aviso.
 */

import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

let pool = null;
let logNeonDisconnected = false;

function warnNeonDisconnected() {
  if (!logNeonDisconnected) {
    console.warn('[db] Neon não conectado — usando dados simulados');
    logNeonDisconnected = true;
  }
}

/**
 * Retorna o pool de conexões ou null se DATABASE_URL ausente.
 * @returns {pg.Pool | null}
 */
export function getPool() {
  const connectionString = config.databaseUrl;
  if (!connectionString) {
    warnNeonDisconnected();
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: config.isProduction ? { rejectUnauthorized: true } : false,
    });
  }
  return pool;
}

/**
 * Executa uma query. Falha se DATABASE_URL não estiver definida.
 * @param {string} text - SQL
 * @param {Array} [params] - Parâmetros
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL não definida. Usando dados simulados.');
  return p.query(text, params);
}

/**
 * Verifica se DATABASE_URL está definida (sem lançar erro).
 * @returns {boolean}
 */
export function isConnected() {
  return !!config.DATABASE_URL;
}

/**
 * Verifica se o banco está realmente acessível (ping).
 * @returns {Promise<boolean>}
 */
export async function isDbConnected() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
