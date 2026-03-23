import pkg from 'pg';
const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não está definida.');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
const poolOpts = {
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
};

const pool = new Pool(poolOpts);

export async function query(text, params) {
  return pool.query(text, params);
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

export default pool;
