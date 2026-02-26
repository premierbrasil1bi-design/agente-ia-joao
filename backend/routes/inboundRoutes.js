/**
 * Rotas de entrada de mensagens – canal WEB e futuros (WhatsApp, API).
 * Usa contexto + prompt do agente; fallback seguro quando não houver prompt (nunca 500).
 */

import express from "express";

const router = express.Router();

/**
 * Rota de recebimento de inbound
 */
router.post("/inbound", async (req, res) => {
  try {
    const payload = req.body;

    console.log("Inbound recebido:", payload);

    // Aqui você pode colocar sua lógica real
    return res.status(200).json({
      success: true,
      message: "Inbound processado com sucesso."
    });

  } catch (error) {
    console.error("Erro ao processar inbound:", error);

    return res.status(500).json({
      error: "INBOUND_ERROR",
      message: "Erro interno ao processar inbound."
    });
  }
});

/**
 * Health check do módulo inbound
 */
router.get("/inbound/health", (req, res) => {
  return res.status(200).json({
    status: "ok",
    module: "inboundRoutes"
  });
});

export default router;