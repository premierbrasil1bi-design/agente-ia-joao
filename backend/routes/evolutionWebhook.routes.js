
import express from 'express';
import axios from 'axios';
const router = express.Router();

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

  const { EVOLUTION_URL, EVOLUTION_INSTANCE, EVOLUTION_API_KEY } = process.env;

  if (!EVOLUTION_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) {
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
  const apiKeySafe = EVOLUTION_API_KEY.length > 4 ? `**${EVOLUTION_API_KEY.slice(-4)}` : '***';

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
          apikey: EVOLUTION_API_KEY
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
