import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const poolOpts = { connectionString, ssl: false };

export const pool = new Pool(poolOpts);
