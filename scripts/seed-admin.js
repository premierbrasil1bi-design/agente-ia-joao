const path = require('path');
const { createRequire } = require('module');

const backendRequire = createRequire(
  path.join(__dirname, '..', 'backend', 'package.json')
);

const pg = backendRequire('pg');
const bcrypt = backendRequire('bcryptjs');
const dotenv = backendRequire('dotenv');

dotenv.config({ path: path.join(__dirname, '..', 'backend', '.env') });
dotenv.config();

const EMAIL = 'joao@omnia1bi.com.br';
const PASSWORD = '123456';
const ROLE = 'global_admin';

function getClientConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL ausente no ambiente (.env).');
  }

  if (/sslmode=disable/i.test(connectionString)) {
    return { connectionString };
  }
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
  };
}

async function getColumns(client) {
  const { rows } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'global_admins'`
  );
  return new Set(rows.map((r) => r.column_name));
}

async function tableExists(client) {
  const { rows } = await client.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'global_admins'
      LIMIT 1`
  );
  return rows.length > 0;
}

async function main() {
  const client = new pg.Client(getClientConfig());

  try {
    await client.connect();

    if (!(await tableExists(client))) {
      throw new Error('Tabela global_admins não existe no banco atual.');
    }

    const existing = await client.query(
      'SELECT id FROM global_admins WHERE email = $1 LIMIT 1',
      [EMAIL]
    );
    if (existing.rows.length > 0) {
      console.log('Admin já existe');
      return;
    }

    const columns = await getColumns(client);
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const fields = ['email', 'password_hash'];
    const values = [EMAIL, passwordHash];
    const placeholders = ['$1', '$2'];
    let idx = 3;

    if (columns.has('role')) {
      fields.push('role');
      values.push(ROLE);
      placeholders.push(`$${idx++}`);
    }
    if (columns.has('name')) {
      fields.push('name');
      values.push('Joao');
      placeholders.push(`$${idx++}`);
    }
    if (columns.has('is_active')) {
      fields.push('is_active');
      values.push(true);
      placeholders.push(`$${idx++}`);
    }
    if (columns.has('created_at')) {
      fields.push('created_at');
      placeholders.push('NOW()');
    }

    await client.query(
      `INSERT INTO global_admins (${fields.join(', ')})
       VALUES (${placeholders.join(', ')})`,
      values
    );

    console.log('Admin criado com sucesso');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed-admin] erro:', err.message || err);
  process.exit(1);
});
