/**

 * Controller do webhook Evolution API.

 * POST /api/webhooks/whatsapp/evolution → resolve canal por external_id e envia ao pipeline.

 */



import { processIncomingMessage } from '../services/messagePipeline.js';

import { sendWhatsAppTextForChannel } from '../services/whatsappOutbound.service.js';

import * as channelsRepo from '../repositories/channelsRepository.js';

import * as agentsRepo from '../repositories/agentsRepository.js';

import { enqueueConversationTask } from '../services/conversationQueueService.js';

import {

  buildMessagesUpsertDedupKey,

  claimWebhookMessageOnce,

} from '../services/evolutionWebhookDedup.service.js';



function normalizeBrazilNumber(raw) {

  if (raw == null) return '';

  let n = String(raw).replace(/\D/g, '');

  if (n.startsWith('55') && n.length === 12) {

    n = n.slice(0, 4) + '9' + n.slice(4);

  }

  return n;

}



/**

 * Recebe payload da Evolution, extrai instance/from/message/timestamp,

 * busca canal por external_id = instance, resolve agent_id e envia ao pipeline.

 */

export async function handleEvolutionWhatsApp(req, res) {

  try {

    const payload = req.body;

    if (!payload || Object.keys(payload).length === 0) {

      return res.status(200).json({ status: 'ignored_empty_webhook' });

    }



    if (payload?.event !== 'messages.upsert') {

      return res.status(200).json({ received: true });

    }



    const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;

    const instance =

      payload?.instance ??

      payload?.instanceName ??

      payload?.data?.instance ??

      null;



    const from =

      data?.key?.remoteJid ||

      data?.key?.participant ||

      null;

    const message =

      data?.message?.conversation ||

      data?.message?.extendedTextMessage?.text ||

      null;

    const timestamp = data?.messageTimestamp ?? Date.now();

    const fromMe = data?.key?.fromMe || false;



    if (fromMe || !message || !from) {

      return res.status(200).json({ received: true });

    }



    if (!instance) {

      console.warn('[EVOLUTION] webhook messages.upsert: instance ausente no payload');

      return res.status(200).json({ received: true });

    }



    const channel = await channelsRepo.findEvolutionChannelByExternalId(instance);

    if (!channel) {

      console.warn('[EVOLUTION] webhook: canal não encontrado external_id=%s', instance);

      return res.status(200).json({ received: true });

    }

    if (!channel.agent_id) {

      console.warn('[EVOLUTION] webhook: canal sem agent_id external_id=%s', instance);

      return res.status(200).json({ received: true });

    }



    const dedupKey = buildMessagesUpsertDedupKey(payload);

    if (!(await claimWebhookMessageOnce(dedupKey))) {

      console.log('[EVOLUTION] webhook duplicate ignored key=%s', dedupKey || '(none)');

      return res.status(200).json({ status: 'duplicate_ignored' });

    }



    const agent = await agentsRepo.findById(channel.agent_id);

    const clientId = agent?.client_id ?? null;

    const agentId = channel.agent_id;

    const channelId = channel.id;

    console.log(

      '[EVOLUTION] webhook messages.upsert → pipeline instance=%s tenant=%s channel=%s',

      instance,

      channel.tenant_id,

      channelId

    );



    let number = from;

    if (typeof number === 'string' && number.endsWith('@s.whatsapp.net')) {

      number = number.replace('@s.whatsapp.net', '');

    }

    number = normalizeBrazilNumber(number) || number;



    const conversationKey = `whatsapp:${from}:${agentId}`;



    enqueueConversationTask(conversationKey, async () => {

      const result = await processIncomingMessage({

        channel: 'whatsapp',

        senderId: from,

        messageText: message,

        timestamp,

        metadata: {

          agentId,

          clientId,

          channelId,

        },

      });



      if (result?.replyText && instance) {

        try {

          await sendWhatsAppTextForChannel(channel, number, result.replyText);

          console.log('[EVOLUTION] webhook: resposta enviada para %s', number);

        } catch (sendErr) {

          console.error('[EVOLUTION] webhook sendText:', sendErr.message);

        }

      }

    });



    return res.status(200).json({ status: 'queued' });

  } catch (err) {

    console.error('[EVOLUTION] handleEvolutionWhatsApp:', err);

    return res.status(200).json({ status: 'error_handled' });

  }

}

