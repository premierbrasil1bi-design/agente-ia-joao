/**
 * Seed inicial do dashboard: cliente padrão, agente, canal WEB e prompt base.
 * Executar após aplicar schema.sql no Neon.
 * Uso: node scripts/seed-dashboard.js
 */

import { config } from '../config/env.js';
import { query, getPool } from '../db/connection.js';

const CLIENT_SLUG = 'cliente-inicial';
const AGENT_SLUG = 'principal';
const CHANNEL_TYPE = 'web';
const PROMPT_BASE = 'Você é um assistente prestativo. Responda em português.';

async function run() {
  const pool = getPool();
  if (!pool) {
    console.error('[seed] DATABASE_URL não definida. Configure o .env e tente novamente.');
    process.exit(1);
  }

  console.log('[seed] Iniciando seed do dashboard...');

  try {
    // 1. Cliente
    await query(
      `INSERT INTO clients (name, slug) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
      ['Cliente Inicial', CLIENT_SLUG]
    );
    const { rows: clientRows } = await query('SELECT id FROM clients WHERE slug = $1', [CLIENT_SLUG]);
    const clientId = clientRows[0]?.id;
    if (!clientId) {
      console.error('[seed] Falha ao obter client_id.');
      process.exit(1);
    }
    console.log('[seed] Cliente:', clientId);

    // 2. Agente
    await query(
      `INSERT INTO agents (client_id, name, slug, status) VALUES ($1, $2, $3, 'ativo')
       ON CONFLICT (client_id, slug) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status`,
      [clientId, 'Agente Principal', AGENT_SLUG]
    );
    const { rows: agentRows } = await query('SELECT id FROM agents WHERE client_id = $1 AND slug = $2', [
      clientId,
      AGENT_SLUG,
    ]);
    const agentId = agentRows[0]?.id;
    if (!agentId) {
      console.error('[seed] Falha ao obter agent_id.');
      process.exit(1);
    }
    console.log('[seed] Agente:', agentId);

    // 3. Canal WEB (apenas se não existir)
    const { rows: chRows } = await query('SELECT id FROM channels WHERE agent_id = $1 AND type = $2', [
      agentId,
      CHANNEL_TYPE,
    ]);
    if (chRows.length === 0) {
      await query(
        `INSERT INTO channels (agent_id, name, type, status, is_active)
         VALUES ($1, 'Web', $2, 'offline', true)`,
        [agentId, CHANNEL_TYPE]
      );
      console.log('[seed] Canal WEB criado.');
    } else {
      console.log('[seed] Canal WEB já existe.');
    }

    // 4. Prompt base (apenas se não existir)
    const { rows: promptRows } = await query(
      'SELECT id FROM prompts WHERE agent_id = $1 AND channel_id IS NULL LIMIT 1',
      [agentId]
    );
    if (promptRows.length === 0) {
      await query(
        'INSERT INTO prompts (agent_id, channel_id, content, version) VALUES ($1, NULL, $2, 1)',
        [agentId, PROMPT_BASE]
      );
      console.log('[seed] Prompt base criado.');
    } else {
      console.log('[seed] Prompt base já existe.');
    }

    console.log('[seed] Concluído. Dashboard pode ser carregado com dados reais.');
  } catch (err) {
    console.error('[seed] Erro:', err.message);
    if (err.code === '42P01') {
      console.error('[seed] Tabela não encontrada. Execute schema.sql e schema-extensions.sql no Neon antes do seed.');
    }
    process.exit(1);
  }
}

run();
