/**
 * Serviço: Dashboard – lógica de negócio do painel.
 * Banco vazio ou erro de query NUNCA causa 500: sempre retorna estrutura válida (zerada ou mock).
 * Métricas: mensagens enviadas/recebidas, custo, uso por canal (WEB, API, WHATSAPP, INSTAGRAM).
 */

import { hasDatabaseUrl } from '../config/env.js';
import * as agentsRepo from '../repositories/agentsRepository.js';
import * as channelsRepo from '../repositories/channelsRepository.js';
import * as messagesRepo from '../repositories/messagesRepository.js';
import * as costsRepo from '../repositories/costsRepository.js';
import * as promptsRepo from '../repositories/promptsRepository.js';

const LOG_PREFIX = '[dashboard]';

const VALID_CHANNELS = ['web', 'api', 'whatsapp', 'instagram'];

/**
 * Resolve canal ativo: header x-channel > query ?channel= > fallback (ex.: inferido do tenant).
 * Retorna sempre um dos valores válidos em minúsculas.
 */
export function resolveChannel(req, fallback = 'web') {
  const header = req?.headers?.['x-channel'];
  const query = req?.query?.channel;
  const h = typeof header === 'string' ? header.trim().toLowerCase() : '';
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (VALID_CHANNELS.includes(h)) return h;
  if (VALID_CHANNELS.includes(q)) return q;
  const fb = typeof fallback === 'string' ? fallback.trim().toLowerCase() : 'web';
  return VALID_CHANNELS.includes(fb) ? fb : 'web';
}

/** Primeiro canal do tenant (tipo) para exibir no dashboard quando não há x-channel. */
async function inferCanalAtivoFromTenant(tenantId) {
  if (!tenantId) return null;
  try {
    const agents = await agentsRepo.findByTenantId(tenantId);
    if (!Array.isArray(agents) || agents.length === 0) return null;
    for (const agent of agents) {
      const chs = await channelsRepo.findByAgentId(agent.id);
      if (!Array.isArray(chs) || chs.length === 0) continue;
      const pick = chs.find((c) => c.is_active !== false) || chs[0];
      const t = String(pick.type || 'whatsapp').toLowerCase();
      if (t === 'whatsapp') return 'WHATSAPP';
      if (t === 'instagram') return 'INSTAGRAM';
      if (t === 'telegram') return 'TELEGRAM';
      if (t === 'web') return 'WEB';
      if (t === 'api') return 'API';
      return t.toUpperCase();
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} inferCanalAtivoFromTenant:`, e?.message || e);
  }
  return null;
}

function hasDb() {
  try {
    return !!hasDatabaseUrl();
  } catch {
    return false;
  }
}

/** Resposta de resumo quando não há DATABASE_URL (mock). */
function mockSummary() {
  return {
    totalGastoHoje: 0.42,
    totalGastoSemana: 2.18,
    totalGastoMes: 8.75,
    mensagensEnviadas: 1247,
    mensagensRecebidas: 1189,
    agentStatus: 'ativo',
    canalAtivo: 'WEB',
    alertas: [{ tipo: 'info', texto: 'Configure DATABASE_URL para persistir dados no Neon.' }],
    porCanal: undefined,
  };
}

/** Resposta de resumo quando banco está vazio ou houve erro (zerado, mensagem coerente). */
function emptySummary(reason = 'Dashboard sem dados configurados.') {
  return {
    totalGastoHoje: 0,
    totalGastoSemana: 0,
    totalGastoMes: 0,
    mensagensEnviadas: 0,
    mensagensRecebidas: 0,
    agentStatus: 'inativo',
    canalAtivo: 'WEB',
    alertas: [{ tipo: 'info', texto: reason }],
    porCanal: {},
  };
}

/** Resumo geral. Nunca lança. */
export async function getSummary(clientId = null, opts = {}) {
  const { tenantId = null, req = null } = opts;

  try {
    if (!hasDb()) {
      const m = mockSummary();
      const canal = req ? resolveChannel(req, 'web') : 'web';
      return { ...m, canalAtivo: canal.toUpperCase() };
    }

    let agents;
    if (clientId) {
      agents = await agentsRepo.findAll(clientId);
    } else if (tenantId) {
      agents = await agentsRepo.findByTenantId(tenantId);
    } else {
      agents = await agentsRepo.findAll(null);
    }
    if (!Array.isArray(agents) || agents.length === 0) {
      const base = emptySummary('Nenhum agente cadastrado. Execute o seed ou cadastre um agente.');
      const canal = req ? resolveChannel(req, 'web') : 'web';
      return { ...base, canalAtivo: canal.toUpperCase() };
    }

    const today = new Date().toISOString().slice(0, 10);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date();
    monthStart.setMonth(monthStart.getMonth() - 1);

    let totalHoje = 0, totalSemana = 0, totalMes = 0;
    let mensagensEnviadas = 0, mensagensRecebidas = 0;
    const porCanal = {};

    for (const agent of agents) {
      const [custos, channels] = await Promise.all([
        costsRepo.findByAgentId(agent.id, { from: today }),
        channelsRepo.findByAgentId(agent.id),
      ]);
      const custosSemana = await costsRepo.findByAgentId(agent.id, { from: weekStart.toISOString().slice(0, 10) });
      const custosMes = await costsRepo.findByAgentId(agent.id, { from: monthStart.toISOString().slice(0, 10) });

      custos.forEach((c) => { totalHoje += Number(c.amount); });
      custosSemana.forEach((c) => { totalSemana += Number(c.amount); });
      custosMes.forEach((c) => { totalMes += Number(c.amount); });

      for (const ch of channels) {
        const msg = Number(ch.message_count) || 0;
        mensagensEnviadas += msg;
        mensagensRecebidas += msg;
        const tipo = (ch.type || 'WEB').toUpperCase();
        if (!porCanal[tipo]) porCanal[tipo] = { mensagens: 0, custoMes: 0 };
        porCanal[tipo].mensagens += msg;
      }
    }

    const totalCustoMes = totalMes;
    const totalMsg = mensagensEnviadas || 1;
    for (const tipo of Object.keys(porCanal)) {
      porCanal[tipo].custoMes = Math.round((totalCustoMes * (porCanal[tipo].mensagens / totalMsg)) * 100) / 100;
    }

    const statuses = agents.map((a) => a.status);
    const agentStatus = statuses.includes('erro') ? 'erro' : statuses.includes('ativo') ? 'ativo' : 'inativo';

    const alertas = [];
    for (const agent of agents) {
      const chs = await channelsRepo.findByAgentId(agent.id);
      const inativos = chs.filter((c) => c.is_active && c.status === 'offline');
      if (inativos.length) alertas.push({ tipo: 'warning', texto: `Canal(s) inativo(s) no agente ${agent.name}.` });
    }

    let canalAtivo =
      canalAtivoFromHeaderOrQuery(headerChannel) ||
      canalAtivoFromHeaderOrQuery(queryChannel);
    if (!canalAtivo && tenantId) {
      canalAtivo = await inferCanalAtivoFromTenant(tenantId);
    }
    if (!canalAtivo) {
      canalAtivo = 'WEB';
    }

    return {
      totalGastoHoje: Math.round(totalHoje * 100) / 100,
      totalGastoSemana: Math.round(totalSemana * 100) / 100,
      totalGastoMes: Math.round(totalMes * 100) / 100,
      mensagensEnviadas,
      mensagensRecebidas,
      agentStatus,
      canalAtivo,
      alertas,
      porCanal: Object.keys(porCanal).length ? porCanal : undefined,
    };
  } catch (err) {
    console.error(`${LOG_PREFIX} getSummary:`, err.message);
    const base = emptySummary('Erro ao carregar dados. Exibindo valores zerados.');
    const canal = opts.req ? resolveChannel(opts.req, 'web') : 'web';
    return { ...base, canalAtivo: canal.toUpperCase() };
  }
}

const emptyAgents = () => [{ id: null, name: 'Nenhum agente', slug: '—', status: 'inativo', client_id: null }];
const emptyChannels = () => [];
const emptyCosts = () => [];
const emptyMessages = () => [];
const emptyPrompts = () => [{ id: null, channel_id: null, content: 'Você é um assistente prestativo.', version: 1 }];

/** Lista agentes. Nunca lança. */
export async function getAgents(clientId = null) {
  try {
    if (!hasDb()) return emptyAgents();
    const rows = await agentsRepo.findAll(clientId);
    return Array.isArray(rows) && rows.length > 0 ? rows : emptyAgents();
  } catch (err) {
    console.error(`${LOG_PREFIX} getAgents:`, err.message);
    return emptyAgents();
  }
}

/** Lista canais. Nunca lança. */
export async function getChannels(agentId = null) {
  try {
    if (!hasDb()) return [];
    if (agentId) return await channelsRepo.findByAgentId(agentId);
    const agents = await agentsRepo.findAll();
    if (!Array.isArray(agents) || agents.length === 0) return [];
    const all = [];
    for (const a of agents) {
      const chs = await channelsRepo.findByAgentId(a.id);
      all.push(...(chs || []).map((c) => ({ ...c, agent_name: a.name })));
    }
    return all;
  } catch (err) {
    console.error(`${LOG_PREFIX} getChannels:`, err.message);
    return emptyChannels();
  }
}

/** Custos. Nunca lança. */
export async function getCosts(agentId = null, filters = {}) {
  try {
    if (!hasDb()) return emptyCosts();
    if (agentId) return await costsRepo.findByAgentId(agentId, filters);
    return await costsRepo.getTotals(agentId, filters);
  } catch (err) {
    console.error(`${LOG_PREFIX} getCosts:`, err.message);
    return emptyCosts();
  }
}

/** Mensagens por agente. Nunca lança. */
export async function getMessages(agentId, options = {}) {
  try {
    if (!hasDb()) return emptyMessages();
    const rows = await messagesRepo.findByAgentId(agentId, options);
    return Array.isArray(rows) ? rows : emptyMessages();
  } catch (err) {
    console.error(`${LOG_PREFIX} getMessages:`, err.message);
    return emptyMessages();
  }
}

/** Prompts por agente. Nunca lança. */
export async function getPrompts(agentId) {
  try {
    if (!hasDb()) return emptyPrompts();
    const rows = await promptsRepo.findByAgentId(agentId);
    return Array.isArray(rows) && rows.length > 0 ? rows : emptyPrompts();
  } catch (err) {
    console.error(`${LOG_PREFIX} getPrompts:`, err.message);
    return emptyPrompts();
  }
}

/** Exporta estruturas vazias para uso nas rotas (fallback). */
export const fallback = {
  summary: () => emptySummary('Dados indisponíveis. Tente novamente.'),
  agents: emptyAgents,
  channels: emptyChannels,
  costs: emptyCosts,
  messages: emptyMessages,
  prompts: emptyPrompts,
};
