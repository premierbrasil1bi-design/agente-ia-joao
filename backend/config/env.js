/**
 * Configuração centralizada – variáveis de ambiente e providers (WAHA, Evolution).
 * Validação de canais: validateChannelProvidersConfig() no startup do servidor.
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

const wahaUrlRaw = (process.env.WAHA_API_URL || process.env.WAHA_URL || '').trim();
const wahaKeyRaw = (process.env.WAHA_API_KEY || '').trim();
const wahaTimeoutRaw = parseInt(process.env.WAHA_REQUEST_TIMEOUT_MS || '5000', 10);
const evoUrlRaw = (process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL || '').trim();
const evoKeyStrict = (process.env.EVOLUTION_API_KEY || '').trim();
const evoKeyLegacy = (process.env.AUTHENTICATION_API_KEY || '').trim();

if (evoUrlRaw && !evoKeyStrict) {
  warn(
    'EVOLUTION_API_KEY',
    'EVOLUTION_API_URL definida — defina EVOLUTION_API_KEY (obrigatório se usar Evolution).'
  );
}
if (!evoUrlRaw && (evoKeyStrict || evoKeyLegacy)) {
  warn('EVOLUTION_API_URL', 'Chave Evolution definida mas URL ausente.');
}

/**
 * Falha rápido no boot se integração WAHA não estiver configurada (Docker / produção).
 * Evolution: se URL estiver definida, exige EVOLUTION_API_KEY.
 */
export function validateChannelProvidersConfig() {
  const summary = {
    wahaEnabled: Boolean(wahaUrlRaw),
    evolutionEnabled: Boolean(evoUrlRaw),
  };
  if (!wahaUrlRaw) {
    console.error('[CONFIG] WAHA_API_URL não configurado - provider desativado');
  } else if (!wahaKeyRaw) {
    console.error('[CONFIG] WAHA_API_KEY não configurado - provider WAHA desativado');
  }
  if (evoUrlRaw && !evoKeyStrict && !evoKeyLegacy) {
    console.error(
      '[CONFIG] EVOLUTION_API_KEY/AUTHENTICATION_API_KEY ausente - provider Evolution desativado'
    );
  }
  console.log('[config] providers summary:', summary);
  return summary;
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
  /** Config somente leitura para clientes HTTP dos providers (sem localhost fixo). */
  providers: {
    waha: {
      url: wahaUrlRaw,
      apiKey: wahaKeyRaw,
      requestTimeoutMs: Number.isFinite(wahaTimeoutRaw) && wahaTimeoutRaw > 0 ? wahaTimeoutRaw : 5000,
    },
    evolution: {
      url: evoUrlRaw,
      apiKey: evoKeyStrict || evoKeyLegacy || '',
    },
  },
};

export const hasDatabaseUrl = () => !!config.databaseUrl;
export const hasJwtSecret = () => !!config.jwt.secret && config.jwt.secret !== 'change-me-in-production';
