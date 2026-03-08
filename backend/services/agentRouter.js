/**
 * Agent Router – resolves which agent (and client/channel) should handle an incoming message
 * based on channel type and instance (e.g. Evolution API instance name).
 * Enables multi-tenant: instance → channel → agent_id.
 */

import * as channelsRepo from '../repositories/channelsRepository.js';
import * as agentsRepo from '../repositories/agentsRepository.js';

/**
 * Resolve agent_id, client_id and channel_id for a given channel type and instance.
 *
 * @param {string} channelType - e.g. "whatsapp", "telegram"
 * @param {string} instance - Channel instance identifier (e.g. Evolution API instance name)
 * @returns {Promise<{ agentId: string, clientId: string, channelId: string } | null>}
 */
export async function resolveAgentForChannel(channelType, instance) {
  if (!channelType || instance == null || String(instance).trim() === '') {
    return null;
  }

  try {
    const channel = await channelsRepo.findByTypeAndInstance(
      String(channelType).toLowerCase().trim(),
      String(instance).trim()
    );

    if (!channel || !channel.agent_id) {
      return null;
    }

    const agent = await agentsRepo.findById(channel.agent_id);
    const clientId = agent?.client_id ?? null;

    return {
      agentId: channel.agent_id,
      clientId,
      channelId: channel.id,
    };
  } catch (err) {
    console.error('[agentRouter] resolveAgentForChannel error:', err.message);
    return null;
  }
}
