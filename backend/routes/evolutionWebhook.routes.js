const express = require('express');
const router = express.Router();

// POST /webhook/evolution
router.post('/webhook/evolution', (req, res) => {
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

  // (Integração com agente será feita depois)

  return res.status(200).json({ success: true });
});

export default router;
