/**
 * Configuração centralizada – variáveis de ambiente.
 * Valida obrigatórios em produção e loga avisos (nunca loga valores de secrets).
 */

import dotenv from 'dotenv';

dotenv.config();

const raw = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  AGENT_JWT_SECRET: process.env.AGENT_JWT_SECRET || 'agent_ia_super_secret_key',
  AGENT_JWT_EXPIRES_IN: process.env.AGENT_JWT_EXPIRES_IN || '1d',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
};

const isProd = raw.NODE_ENV === 'production';

function warn(name, message) {
  console.warn(`[config] ${name}: ${message}`);
}

if (isProd) {
  if (!raw.DATABASE_URL) warn('DATABASE_URL', 'não definida – painel usará dados simulados');
  if (!raw.JWT_SECRET || raw.JWT_SECRET === 'change-me-in-production') {
    warn('JWT_SECRET', 'ausente ou valor padrão – defina um secret forte em produção');
  }
} else {
  if (!raw.DATABASE_URL) warn('DATABASE_URL', 'não definida – usando dados simulados (Neon)');
  if (!raw.JWT_SECRET) warn('JWT_SECRET', 'não definida – usando fallback interno (apenas desenvolvimento)');
}

export const config = {
  env: raw.NODE_ENV,
  isProduction: isProd,
  port: raw.PORT,
  databaseUrl: raw.DATABASE_URL,
  jwt: {
    secret: raw.JWT_SECRET || 'change-me-in-production',
    expiresIn: raw.JWT_EXPIRES_IN,
  },
  agentJwt: {
    secret: raw.AGENT_JWT_SECRET,
    expiresIn: raw.AGENT_JWT_EXPIRES_IN,
  },
  openai: {
    apiKey: raw.OPENAI_API_KEY,
  },
};

export const hasDatabaseUrl = () => !!config.databaseUrl;
export const hasJwtSecret = () => !!config.jwt.secret && config.jwt.secret !== 'change-me-in-production';
