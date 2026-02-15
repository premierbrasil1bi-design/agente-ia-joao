
import express from 'express';
import axios from 'axios';
const router = express.Router();

// POST /webhook/evolution
router.post('/webhook/evolution', async (req, res) => {
  const body = req.body;

  console.log('[EVOLUTION WEBHOOK] Payload:', JSON.stringify(body));

  const text =
    body?.data?.message?.conversation ||
    body?.data?.message?.extendedTextMessage?.text;

  let number = body?.data?.key?.remoteJid;
  if (typeof number === 'string' && number.endsWith('@s.whatsapp.net')) {
    number = number.replace('@s.whatsapp.net', '');
  }

  if (!text || !number) {
    return res.status(200).json({ received: true });
  }

  const { EVOLUTION_URL, EVOLUTION_INSTANCE, EVOLUTION_API_KEY } = process.env;

  if (!EVOLUTION_URL || !EVOLUTION_INSTANCE || !EVOLUTION_API_KEY) {
    console.error('[ENV ERROR] Variáveis da Evolution não configuradas.');
    return res.status(200).json({ success: true });
  }

  const instance = encodeURIComponent(EVOLUTION_INSTANCE);
  const evolutionUrl = `${EVOLUTION_URL}/message/sendText/${instance}`;

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
    console.error('[EVOLUTION ERROR][IA]', err.response?.data || err.message);
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
    console.error('[EVOLUTION ERROR][SEND]', err.response?.data || err.message);
  }

  return res.status(200).json({ success: true });
});

export default router;
