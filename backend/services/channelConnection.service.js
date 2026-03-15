/**
 * Serviço de conexão de canais WhatsApp via Evolution API.
 * Orquestra criação de instância, QR, status e desconexão.
 */

import * as evolutionService from './evolutionService.js';
import * as channelRepo from '../repositories/channel.repository.js';

/**
 * Gera o nome da instância no formato omnia_{channel.id}
 */
function instanceNameForChannel(channel) {
  return `omnia_${channel.id}`;
}

/**
 * Inicia conexão WhatsApp: cria instância na Evolution e persiste estado.
 * @param {object} channel - canal com id, tenant_id
 * @returns {Promise<{ instanceName: string }>}
 */
export async function connectWhatsAppChannel(channel) {
  const instanceName = instanceNameForChannel(channel);

  await evolutionService.createInstance(instanceName);

  await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    external_id: instanceName,
    provider: 'evolution',
    status: 'connecting',
  });

  console.log('[channelConnection] Instance created:', instanceName, 'channel:', channel.id);
  return instanceName;
}

/**
 * Obtém QR Code para o canal (usa external_id = instanceName).
 */
export async function getChannelQrCode(channel) {
  if (!channel?.external_id) {
    throw new Error('Canal sem external_id (instância não criada).');
  }
  return evolutionService.getQrCode(channel.external_id);
}

/**
 * Obtém status na Evolution e atualiza banco se status = "open".
 */
export async function getChannelStatus(channel) {
  if (!channel?.external_id) {
    return { state: null, channel };
  }

  const state = await evolutionService.getInstanceStatus(channel.external_id);

  if (state?.state === 'open' || state?.instance?.state === 'open') {
    await channelRepo.updateConnection(channel.id, channel.tenant_id, {
      status: 'connected',
      connected_at: new Date(),
      last_error: null,
    });
  }

  return { state, channel };
}

/**
 * Desconecta instância na Evolution e atualiza banco.
 */
export async function disconnectChannel(channel) {
  if (!channel?.external_id) {
    await channelRepo.updateConnection(channel.id, channel.tenant_id, { status: 'disconnected' });
    return;
  }

  try {
    await evolutionService.disconnectInstance(channel.external_id);
  } catch (err) {
    console.error('[channelConnection] disconnectInstance error:', err.message);
  }

  await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    status: 'disconnected',
    external_id: null,
    connected_at: null,
  });
  console.log('[channelConnection] Disconnected channel:', channel.id);
}
