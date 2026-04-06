import pg from 'pg';
import { resolveDatabaseUrl, maskDatabaseUrl, buildPoolOptions } from './databaseConfig.js';

const { Pool } = pg;

const connectionString = resolveDatabaseUrl();
console.log('[DB] Connecting to:', maskDatabaseUrl(connectionString));

const poolOpts = buildPoolOptions(connectionString);

export const pool = new Pool(poolOpts);
