
import express from 'express';
import axios from 'axios';
const router = express.Router();

// POST /webhook/evolution
router.post('/webhook/evolution', async (req, res) => {
  const body = req.body;

  // Extrai texto da mensagem (ordem de fallback)
  const text = body?.data?.message?.conversation ||
               body?.data?.message?.extendedTextMessage?.text;

  // Extrai número do remetente e remove sufixo
  let number = body?.data?.key?.remoteJid;
  if (typeof number === 'string' && number.endsWith('@s.whatsapp.net')) {
    number = number.replace('@s.whatsapp.net', '');
  }

  // Loga o payload recebido
  console.log('[EVOLUTION WEBHOOK] Payload:', JSON.stringify(body));

  // Se não houver texto ou número, retorna 200
  if (!text || !number) {
    return res.status(200).json({ received: true });
  }

  // Integração com agente IA e Evolution
  try {
    // Enviar mensagem para o agente IA
    const agentResponse = await axios.post(
      'https://agente-ia-joao-production.up.railway.app/message',
      {
        text,
        agent_id: 'b5144047-b7a8-4c17-ab42-466bbbf2ac51'
      }
    );

    const respostaIA = agentResponse.data.response;

    // Enviar resposta para WhatsApp via Evolution
    await axios.post(
      'http://187.77.35.190:8080/message/sendText/Consultorio Dra Ana Paula',
      {
        number,
        text: respostaIA
      },
      {
        headers: {
          apikey: '916DA6B83948-44CF-9997-62E8B181D2BC'
        }
      }
    );
  } catch (err) {
    console.error('Erro no fluxo IA:', err.message);
  }

  return res.status(200).json({ success: true });
});

export default router;
