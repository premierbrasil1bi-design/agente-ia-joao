/**
 * Rotas CRUD de canais – Client App (app.omnia1biai.com.br).
 * Protegidas por agentAuth (JWT do Client App); req.user e req.tenantId disponíveis.
 */

import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { requireActiveTenant } from '../middleware/requireActiveTenant.js';
import { sendBadRequest, sendNotFound } from '../utils/errorResponses.js';
import { pool } from '../db/pool.js';
import * as channelConnectionService from '../services/channelConnection.service.js';
import * as evolutionService from '../services/evolutionService.js';
import { normalizeEvolutionState } from '../utils/evolutionState.js';
import { invalidateTenantChannels } from '../utils/channelCache.js';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';

const router = Router();

/** Valor para `connection.qrCode`: base64 cru da Evolution ou data URL para `<img src>`. */
function qrCodeForConnection(qrRaw) {
  if (qrRaw == null) return null;
  if (typeof qrRaw === 'object' && typeof qrRaw.base64 === 'string' && qrRaw.base64.trim()) {
    return qrRaw.base64.trim();
  }
  return toQrDataUrl(extractQrPayload(qrRaw));
}

/** Estado bruto da Evolution no objeto retornado por getChannelStatus. */
function rawEvolutionStateFromStatusResult(statusResult) {
  const st = statusResult?.state;
  if (st == null) return null;
  return st.state ?? st.instance?.state ?? null;
}

/**
 * 'fetch_qr' = pode chamar getChannelQrCode; 'wait' = só aguardar; 'already_connected' = pareado, sem QR.
 */
function classifyStatusForQr(statusResult) {
  if (statusResult?.evolutionOffline || statusResult?.instanceNotFound) {
    return 'wait';
  }

  const ns = String(statusResult?.normalizedStatus || '').toLowerCase();
  const raw = rawEvolutionStateFromStatusResult(statusResult);
  const rawLower = raw != null ? String(raw).trim().toLowerCase() : '';

  if (ns === 'connected' || rawLower === 'open') {
    return 'already_connected';
  }

  const ready =
    ns === 'connecting' ||
    ns === 'qr' ||
    rawLower === 'connecting' ||
    rawLower === 'qr';

  if (ready) return 'fetch_qr';
  return 'wait';
}

/**
 * Repete status → (se pronto) QR até obter payload exibível (máx. 10 tentativas, 1s entre cada).
 * Evita getChannelQrCode enquanto a Evolution não estiver em connecting/qr.
 */
async function waitForQrCode(channel, maxAttempts = 10, delayMs = 1000) {
  const id = channel.id;
  const tenantId = channel.tenant_id;

  for (let i = 0; i < maxAttempts; i++) {
    const ch = await channelRepo.findById(id, tenantId);
    if (!ch) return { qrCode: null, alreadyConnected: false };

    try {
      const statusResult = await channelConnectionService.getChannelStatus(ch);
      const channelForQr = statusResult.channel ?? ch;

      const phase = classifyStatusForQr(statusResult);
      if (phase === 'already_connected') {
        return { qrCode: null, alreadyConnected: true };
      }

      if (phase === 'wait') {
        if (i < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        continue;
      }

      const qrRaw = await channelConnectionService.getChannelQrCode(channelForQr);
      const code = qrCodeForConnection(qrRaw);
      if (code) {
        return { qrCode: code, alreadyConnected: false };
      }
    } catch {
      /* próxima tentativa após delay */
    }

    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { qrCode: null, alreadyConnected: false };
}

router.use(agentAuth);

/** Status de UI para WhatsApp (Evolution): alinha evolution_status + status interno active/inactive. */
function evolutionUiStatus(ch) {
  const ev = ch.evolution_status;
  if (ev != null && String(ev).trim() !== '') {
    return normalizeEvolutionState(ev);
  }
  const internal = String(ch.status || '').toLowerCase();
  if (internal === 'active') return 'connected';
  if (ch.external_id) return 'created';
  return 'disconnected';
}

/**
 * Garante que cada canal tenha o campo "type" no JSON (contrato do frontend).
 * Canais Evolution (provider === 'evolution') retornam sempre type: "whatsapp" para os botões aparecerem.
 */
function normalizeChannelForApi(ch) {
  if (!ch || typeof ch !== 'object') return ch;
  const isEvolution = String(ch.provider || '').toLowerCase() === 'evolution';
  const type =
    isEvolution
      ? 'whatsapp'
      : (ch.type != null && String(ch.type).trim() !== '')
        ? String(ch.type).trim().toLowerCase()
        : 'api';
  if (isEvolution) {
    return { ...ch, type, status: evolutionUiStatus(ch) };
  }
  return { ...ch, type };
}

/**
 * GET /api/channels (e GET /api/agent/channels – mesma rota)
 * Retorna todos os canais do tenant do usuário logado.
 * Garante que cada item inclua o campo "type" para o frontend exibir os botões WhatsApp.
 */
router.get('/', requireActiveTenant, async (req, res) => {
  try {
    const evolutionData = await evolutionService.checkEvolutionHealth();
    res.status(200).json(evolutionData);
  } catch (err) {
    console.error('[channels] GET /:', err.message);
    const status = err.response?.status || 500;
    const payload = err.response?.data ?? { error: err.message || 'Erro ao listar canais.' };
    res.status(status).json(payload);
  }
});

/**
 * POST /api/channels/:id/create-instance
 * Criação manual da instância na Evolution (não automática em connect/status).
 */
router.post('/:id/create-instance', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const channel = await channelRepo.findById(req.params.id, tenantId);
    if (!channel) {
      return sendNotFound(res, 'Canal não encontrado.');
    }

    const ext = channel.external_id != null ? String(channel.external_id).trim() : '';
    if (ext) {
      return res.status(200).json({
        success: false,
        error: true,
        message: 'Instance already exists',
      });
    }

    const result = await channelConnectionService.createWhatsAppInstance({
      ...channel,
      tenant_id: tenantId,
    });

    if (result.createResponse?.skipped && result.createResponse?.reason === 'instance_already_exists') {
      return res.status(200).json({
        success: false,
        error: true,
        message: 'Instance already exists',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Instance created successfully',
      instanceName: result.instanceName,
    });
  } catch (err) {
    console.error('[channels] POST /:id/create-instance:', err.message);
    const axStatus = err.response?.status;
    const detail =
      err.response?.data?.message || err.response?.data?.error || err.message || 'Falha ao criar instância.';
    if (axStatus === 409) {
      return res.status(200).json({
        success: false,
        error: true,
        message: 'Instance already exists',
      });
    }
    return res.status(502).json({
      success: false,
      error: true,
      message: detail,
    });
  }
});

/**
 * GET /api/channels/:id
 * Retorna o canal com o campo "type" garantido (contrato do frontend).
 */
router.get('/:id', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }
    const channel = await channelRepo.findById(req.params.id, tenantId);
    if (!channel) {
      return sendNotFound(res, 'Canal não encontrado.');
    }
    res.status(200).json(normalizeChannelForApi(channel));
  } catch (err) {
    console.error('[channels] GET /:id:', err.message);
    res.status(500).json({ error: 'Erro ao buscar canal.' });
  }
});

/**
 * POST /api/channels
 * Cria o canal no banco e, em seguida, fluxo Evolution: instância (se não existir) → connect → QR.
 * Não remove o canal se a Evolution falhar na criação da instância.
 *
 * Body recomendado (Client App):
 *   { name, agentId }
 *
 * Compatibilidade: ainda aceita { type, instance, agent_id, active }.
 */
router.post('/', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const { name, agentId, agent_id, type, instance, active } = req.body || {};
    const finalAgentId = agent_id || agentId;

    if (!finalAgentId) {
      return sendBadRequest(res, 'agent_id (ou agentId) é obrigatório.');
    }

    const { rows: agentRows } = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND tenant_id = $2',
      [finalAgentId, tenantId]
    );
    if (agentRows.length === 0) {
      return sendBadRequest(res, 'Agente não encontrado ou não pertence ao tenant.');
    }

    const instanceFromInput = String(instance || name || '')
      .trim()
      .replace(/\s+/g, '-');
    const safeInstanceName = instanceFromInput || `channel-${Date.now()}`;

    const channel = await channelRepo.create({
      tenant_id: tenantId,
      agent_id: finalAgentId,
      type: type || 'whatsapp',
      instance: safeInstanceName,
      active: active ?? true,
    });

    try {
      await evolutionService.createInstance(safeInstanceName);

      let latest = await channelRepo.updateConnection(channel.id, tenantId, {
        provider: 'evolution',
        external_id: safeInstanceName,
        status: 'inactive',
        evolution_status: 'created',
      });
      if (!latest) {
        latest = await channelRepo.findById(channel.id, tenantId);
      }

      let warning = null;
      try {
        const connectResult = await channelConnectionService.connectWhatsAppChannel(latest);
        latest = connectResult.channel ?? latest;
      } catch (connErr) {
        console.error('[channels] POST / connect:', connErr.message);
        warning = connErr.message || 'Falha ao iniciar conexão com a Evolution.';
        latest = await channelRepo.findById(channel.id, tenantId);
      }

      let qrCode = null;
      try {
        const qrOutcome = await waitForQrCode(latest);
        qrCode = qrOutcome.qrCode;
        if (!qrCode && !qrOutcome.alreadyConnected) {
          warning =
            warning ||
            'QR Code ainda não disponível após várias tentativas. Atualize a tela ou use o fluxo de conexão.';
        }
      } catch (qrErr) {
        console.error('[channels] POST / qrcode:', qrErr.message);
        warning = warning || qrErr.message || 'Falha ao obter QR Code.';
      }

      invalidateTenantChannels(tenantId);

      const fullChannel = normalizeChannelForApi(await channelRepo.findById(channel.id, tenantId));

      return res.status(200).json({
        success: true,
        channel: fullChannel,
        connection: {
          status: 'connecting',
          qrCode,
        },
        ...(warning ? { warning } : {}),
      });
    } catch (evoErr) {
      console.error('[channels] POST / evolution:', evoErr.message);
      const fresh = await channelRepo.findById(channel.id, tenantId);
      const axData = evoErr.response?.data;
      const detail =
        (typeof axData === 'string' && axData) ||
        axData?.message ||
        axData?.error ||
        evoErr.message ||
        'Falha ao criar instância na Evolution.';

      const status = evoErr.response?.status || 200;
      return res.status(status).json({
        success: false,
        error: true,
        message: detail,
        channel: normalizeChannelForApi(fresh),
      });
    }
  } catch (err) {
    console.error('[channels] POST /:', err.message);
    res.status(500).json({ error: 'Erro ao criar canal.' });
  }
});

/**
 * PUT /api/channels/:id
 * Atualiza canal apenas se pertencer ao tenant.
 */
router.put('/:id', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const existing = await channelRepo.findById(req.params.id, tenantId);
    if (!existing) {
      return sendNotFound(res, 'Canal não encontrado.');
    }

    const { type, instance, agent_id, active } = req.body || {};
    const updated = await channelRepo.update(req.params.id, tenantId, {
      type,
      instance,
      agent_id,
      active,
    });
    res.status(200).json(updated);
  } catch (err) {
    console.error('[channels] PUT /:id:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar canal.' });
  }
});

/**
 * DELETE /api/channels/:id
 * Remove canal apenas se pertencer ao tenant.
 */
router.delete('/:id', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const existing = await channelRepo.findById(req.params.id, tenantId);
    if (!existing) {
      return sendNotFound(res, 'Canal não encontrado.');
    }

    const ext = existing.external_id != null ? String(existing.external_id).trim() : '';
    if (String(existing.provider || '').toLowerCase() === 'evolution' && ext) {
      try {
        await evolutionService.deleteInstance(ext);
        console.log('[channels] DELETE: deleteInstance Evolution OK:', ext);
      } catch (e) {
        console.warn('[channels] DELETE: deleteInstance falhou, tentando logout + delete:', e.message);
        try {
          await evolutionService.disconnectInstance(ext);
          await evolutionService.deleteInstance(ext);
          console.log('[channels] DELETE: Evolution removida após logout:', ext);
        } catch (e2) {
          console.warn('[channels] DELETE: Evolution (seguindo exclusão no banco):', e2.message);
        }
      }
    }

    await channelRepo.deleteById(req.params.id, tenantId);
    invalidateTenantChannels(tenantId);
    res.status(204).send();
  } catch (err) {
    console.error('[channels] DELETE /:id:', err.message);
    res.status(500).json({ error: 'Erro ao remover canal.' });
  }
});

export default router;
