import { Router } from 'express';
import {
  getWebhookConfig,
  isValidWebhookUrl,
  isValidWebhookSecret,
  sanitizeWebhookConfig,
  setWebhookConfig,
} from '../services/alertWebhookConfigStore.js';

const router = Router();

router.post('/webhook-config', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });

    const url = String(req.body?.url || '').trim();
    const secret = req.body?.secret == null ? null : String(req.body.secret);
    if (!url || !isValidWebhookUrl(url)) {
      return res.status(400).json({ error: 'URL inválida. Use http(s).' });
    }
    if (!isValidWebhookSecret(secret)) {
      return res.status(400).json({ error: 'Secret inválido. Use ao menos 12 caracteres.' });
    }

    const saved = setWebhookConfig({
      tenantId,
      url,
      isActive: true,
      secret,
    });
    return res.status(200).json({ success: true, config: sanitizeWebhookConfig(saved) });
  } catch (err) {
    console.error('[alerts] webhook-config:', err.message);
    return res.status(500).json({ error: 'Falha ao salvar configuração de webhook.' });
  }
});

router.get('/webhook-config', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const cfg = getWebhookConfig(tenantId);
    return res.status(200).json({ config: sanitizeWebhookConfig(cfg) });
  } catch (err) {
    console.error('[alerts] webhook-config get:', err.message);
    return res.status(500).json({ error: 'Falha ao buscar configuração de webhook.' });
  }
});

export default router;

