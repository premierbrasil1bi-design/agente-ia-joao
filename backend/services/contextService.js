/**
 * Serviço: contexto de execução (canal ativo, prompt em uso).
 * Regra: prompt do canal sobrescreve o prompt base; fallback sempre para o base (channel_id NULL).
 * Uso no Neon: prompts por agent_id/channel_id; sem banco retorna contexto mínimo.
 */

import { hasDatabaseUrl } from '../config/env.js';
import * as channelsRepo from '../repositories/channelsRepository.js';
import * as promptsRepo from '../repositories/promptsRepository.js';
import * as agentsRepo from '../repositories/agentsRepository.js';

const hasDb = () => hasDatabaseUrl();

/**
 * Retorna o contexto atual: client_id, agent_id, channel, prompt_id, nome do canal.
 * Valida se o canal existe (por tipo) para o agente.
 */
export async function getContext(clientId, agentId, channelType = 'web') {
  const channelLower = (channelType || 'web').trim().toLowerCase();
  const channelUpper = channelLower.toUpperCase();

  if (!hasDb()) {
    return {
      client_id: clientId ?? null,
      agent_id: agentId ?? null,
      channel: channelUpper,
      prompt_id: null,
      canal_nome: channelUpper,
    };
  }

  try {
    if (!agentId) {
      return {
        client_id: clientId ?? null,
        agent_id: null,
        channel: channelUpper,
        prompt_id: null,
        canal_nome: channelUpper,
      };
    }

    const agent = await agentsRepo.findById(agentId);
    if (!agent) {
      return {
        client_id: clientId ?? agent?.client_id ?? null,
        agent_id: agentId,
        channel: channelUpper,
        prompt_id: null,
        canal_nome: channelUpper,
      };
    }

    const channels = await channelsRepo.findByAgentId(agentId);
    const channel = channels.find(
      (c) => (c.type || '').toLowerCase() === channelLower
    );

    const channelId = channel?.id ?? null;
    const canalNome = (channel?.name || channelUpper).toUpperCase();

    let promptId = null;
    const promptBase = await promptsRepo.findBaseByAgentId(agentId);
    const promptByChannel = channelId
      ? await promptsRepo.findByChannelId(agentId, channelId)
      : null;
    const prompt = promptByChannel ?? promptBase;
    if (prompt) promptId = prompt.id;

    return {
      client_id: clientId ?? agent.client_id,
      agent_id: agentId,
      channel: channelUpper,
      prompt_id: promptId,
      canal_nome: canalNome,
    };
  } catch (err) {
    console.error('contextService.getContext:', err.message);
    return {
      client_id: clientId ?? null,
      agent_id: agentId ?? null,
      channel: channelUpper,
      prompt_id: null,
      canal_nome: channelUpper,
    };
  }
}
