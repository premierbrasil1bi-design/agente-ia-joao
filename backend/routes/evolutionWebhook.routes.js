import express from 'express';
import axios from 'axios';
import { processIncomingMessage } from '../services/messagePipeline.js';
import * as evolutionService from '../services/evolutionService.js';
import * as channelsRepo from '../repositories/channelsRepository.js';
import { sendWhatsAppTextForChannel } from '../services/whatsappOutbound.service.js';
import { resolveAgentForChannel } from '../services/agentRouter.js';
import { enqueueConversationTask } from '../services/conversationQueueService.js';
import * as evolutionWebhookController from '../controllers/evolutionWebhook.controller.js';

const router = express.Router();

// POST /api/webhooks/whatsapp/evolution – Evolution → canal por external_id → pipeline
router.post('/webhooks/whatsapp/evolution', evolutionWebhookController.handleEvolutionWhatsApp);

function normalizeBrazilNumber(raw) {
  if (raw == null) return '';
  let n = String(raw).replace(/\D/g, '');
  if (n.startsWith('55') && n.length === 12) {
    n = n.slice(0, 4) + '9' + n.slice(4);
  }
  return n;
}

// POST /agents/webhook – Evolution API → agent router → message pipeline → Evolution send
router.post('/agents/webhook', async (req, res) => {
  try {
    console.log('[WEBHOOK DEBUG]', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      bodyKeys: Object.keys(req.body || {}),
      time: new Date().toISOString()
    });

    if (!req.body || Object.keys(req.body).length === 0) {
      console.log('[WEBHOOK] Ignored empty webhook call');
      return res.status(200).json({ status: 'ignored_empty_webhook' });
    }

    const payload = req.body;

    console.log('========== WEBHOOK RECEIVED ==========');
    console.log(JSON.stringify(payload, null, 2));

    if (payload?.event === 'messages.upsert') {
      const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;

      const sender =
        data?.key?.remoteJid ||
        data?.key?.participant ||
        null;

      const messageText =
        data?.message?.conversation ||
        data?.message?.extendedTextMessage?.text ||
        null;

      const fromMe = data?.key?.fromMe || false;

      const instance =
        payload?.instance ??
        payload?.instanceName ??
        req.query?.instance ??
        payload?.data?.instance ??
        process.env.EVOLUTION_INSTANCE ??
        null;

      if (!fromMe && messageText && sender) {
        console.log('========== NEW MESSAGE ==========');
        console.log('Sender:', sender);
        console.log('Message:', messageText);
        console.log('Instance:', instance);

        let agentId = null;
        let clientId = null;
        let channelId = null;

        if (instance) {
          const agentInfo = await resolveAgentForChannel('whatsapp', instance);
          if (agentInfo) {
            agentId = agentInfo.agentId;
            clientId = agentInfo.clientId;
            channelId = agentInfo.channelId;
            console.log('[WEBHOOK] Agent resolved:', { agentId, clientId, channelId });
          } else {
            console.warn('[WEBHOOK] No agent found for instance:', instance, '- using env fallback');
          }
        }

        if (agentId == null) {
          agentId = process.env.EVOLUTION_AGENT_ID || process.env.DEFAULT_AGENT_ID || null;
        }

        const instanceForSend = instance || process.env.EVOLUTION_INSTANCE;
        let number = sender;
        if (typeof number === 'string' && number.endsWith('@s.whatsapp.net')) {
          number = number.replace('@s.whatsapp.net', '');
        }
        number = normalizeBrazilNumber(number) || number;

        const conversationKey = `whatsapp:${sender}:${agentId ?? 'null'}`;

        enqueueConversationTask(conversationKey, async () => {
          const result = await processIncomingMessage({
            channel: 'whatsapp',
            senderId: sender,
            messageText,
            timestamp: data?.messageTimestamp ?? Date.now(),
            metadata: {
              ...payload,
              agentId,
              clientId,
              channelId,
            },
          });

          if (result?.replyText && instanceForSend) {
            try {
              const ch = await channelsRepo.findEvolutionChannelByExternalId(String(instanceForSend).trim());
              if (ch) {
                await sendWhatsAppTextForChannel(ch, number, result.replyText);
              } else {
                await evolutionService.sendText(instanceForSend, number, result.replyText);
              }
              console.log('[WEBHOOK] Reply sent to', number);
            } catch (sendErr) {
              console.error('[WEBHOOK] sendText error:', sendErr.message);
            }
          }
        });

        return res.status(200).json({ status: 'queued' });
      }
    }

    res.status(200).json({ status: 'webhook_received' });
  } catch (error) {
    console.error('[WEBHOOK] Error:', error);
    res.status(200).json({ status: 'error_handled' });
  }
});

// POST /webhook/evolution
router.post('/webhook/evolution', async (req, res) => {
  const body = req.body;

  // Função para normalizar número BR
  function normalizeBrazilNumber(raw) {
    let n = String(raw).replace(/\D/g, '');
    if (n.startsWith('55') && n.length === 12) {
      // 55 + DDD (2) + 8 dígitos: inserir 9 após DDD
      n = n.slice(0, 4) + '9' + n.slice(4);
    }
    return n;
  }

  console.log('[EVOLUTION WEBHOOK] Payload:', JSON.stringify(body));

  // Processa apenas mensagens reais
  if (body?.event !== 'messages.upsert') {
    return res.status(200).json({ received: true });
  }

  const messageData = Array.isArray(body?.data)
    ? body.data[0]
    : body?.data;

  const text =
    messageData?.message?.conversation ||
    messageData?.message?.extendedTextMessage?.text;

  let numberRaw = messageData?.key?.remoteJid;
  if (typeof numberRaw === 'string' && numberRaw.endsWith('@s.whatsapp.net')) {
    numberRaw = numberRaw.replace('@s.whatsapp.net', '');
  }
  const number = normalizeBrazilNumber(numberRaw);

  if (!text || !number) {
    return res.status(200).json({ received: true });
  }

  if (number.length < 13) {
    console.warn('[EVOLUTION WARNING] Número suspeito:', numberRaw, '->', number);
  }

  const { EVOLUTION_URL, EVOLUTION_INSTANCE, AUTHENTICATION_API_KEY } = process.env;

  if (!EVOLUTION_URL || !EVOLUTION_INSTANCE || !AUTHENTICATION_API_KEY) {
    console.error('[ENV ERROR] Variáveis da Evolution não configuradas.');
    return res.status(200).json({ success: true });
  }

  // Garantir encode correto da instância
  let instance = EVOLUTION_INSTANCE;
  if (/%[0-9A-Fa-f]{2}/.test(instance)) {
    try { instance = decodeURIComponent(instance); } catch {}
  }
  const instanceEncoded = encodeURIComponent(instance);
  const evolutionUrl = `${EVOLUTION_URL}/message/sendText/${instanceEncoded}`;

  // Log seguro da apikey
  const apiKeySafe =
    AUTHENTICATION_API_KEY.length > 4 ? `**${AUTHENTICATION_API_KEY.slice(-4)}` : '***';

  // Logs detalhados
  console.log('[EVOLUTION DEBUG] Número bruto:', numberRaw);
  console.log('[EVOLUTION DEBUG] Número normalizado:', number);
  console.log('[EVOLUTION DEBUG] Instance original:', EVOLUTION_INSTANCE);
  console.log('[EVOLUTION DEBUG] Instance encoded:', instanceEncoded);
  console.log('[EVOLUTION DEBUG] URL final:', evolutionUrl);
  console.log('[EVOLUTION DEBUG] API KEY (final):', apiKeySafe);

  let respostaIA = '';

  try {
    const agentResponse = await axios.post(
      'https://agente-ia-joao-production.up.railway.app/message',
      {
        text,
        agent_id: 'b5144047-b7a8-4c17-ab42-46b6bbf2ac51'
      },
      { timeout: 15000 }
    );

    respostaIA = agentResponse.data.response;

  } catch (err) {
    console.error('[EVOLUTION ERROR][IA]', err.code, err.message, err.response?.status, err.response?.data);
    respostaIA = 'Desculpe, ocorreu um erro temporário. Tente novamente.';
  }

  console.log('[EVOLUTION] Enviando resposta para:', number);

  try {
    await axios.post(
      evolutionUrl,
      {
        number,
        text: respostaIA
      },
      {
        headers: {
          apikey: AUTHENTICATION_API_KEY
        },
        timeout: 15000
      }
    );

  } catch (err) {
    console.error('[EVOLUTION ERROR][SEND]', err.code, err.message, err.response?.status, err.response?.data);
  }

  return res.status(200).json({ success: true });
});

export default router;
