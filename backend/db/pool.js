import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const poolOpts = { connectionString };
if (connectionString && !/sslmode=disable/i.test(connectionString)) {
  poolOpts.ssl = { rejectUnauthorized: false };
}

export const pool = new Pool(poolOpts);
