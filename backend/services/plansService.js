/**
 * Serviço: planos (preparação para comercialização).
 * Estrutura base para free, pro, enterprise. Sem cobrança ainda.
 * Usa tabela plans (schema-extensions.sql).
 */

import { hasDatabaseUrl } from '../config/env.js';
import { query } from '../db/connection.js';

const SLUGS = { free: 'free', pro: 'pro', enterprise: 'enterprise' };

/**
 * Lista planos do cliente (ou mock). Base para futura cobrança.
 * @param {string} [clientId] - UUID do cliente
 * @returns {Promise<Array<{ id, name, slug, limits }>>}
 */
export async function getPlansByClientId(clientId = null) {
  if (!hasDatabaseUrl()) {
    return [
      { id: 'mock-free', name: 'Free', slug: SLUGS.free, limits: { messages_per_month: 1000 } },
      { id: 'mock-pro', name: 'Pro', slug: SLUGS.pro, limits: { messages_per_month: 10000 } },
      { id: 'mock-enterprise', name: 'Enterprise', slug: SLUGS.enterprise, limits: {} },
    ];
  }
  try {
    const { rows } = await query(
      'SELECT id, client_id, name, slug, limits, created_at FROM plans WHERE ($1::uuid IS NULL OR client_id = $1) ORDER BY name',
      [clientId || null]
    );
    return rows.length ? rows : [
      { id: null, name: 'Free', slug: SLUGS.free, limits: { messages_per_month: 1000 } },
    ];
  } catch (err) {
    console.error('plansService.getPlansByClientId:', err.message);
    return [{ id: null, name: 'Free', slug: SLUGS.free, limits: {} }];
  }
}
