import express from 'express';
import { findActiveChannels } from '../repositories/channel.repository.js';
import { getMessagingHealth } from '../services/providerHealth.js';
import { getSessionMonitorState } from '../services/sessionMonitor.js';
import { getSessionOrchestratorRuntime } from '../services/sessionOrchestrator.js';
import { getTelemetry } from '../services/telemetry.service.js';

const router = express.Router();

router.get('/sessions', async (req, res) => {
  try {
    const [monitor, runtime, telemetry, health, channels] = await Promise.all([
      getSessionMonitorState(),
      getSessionOrchestratorRuntime(),
      getTelemetry(),
      getMessagingHealth(),
      findActiveChannels(),
    ]);

    const sessions = (channels || []).map((channel) => ({
      tenantId: channel.tenant_id || null,
      channelId: channel.id,
      sessionName:
        channel.session_name ||
        channel.external_id ||
        channel.instance ||
        'default',
      provider: channel.provider || null,
      status: channel.connection_status || channel.status || 'unknown',
    }));

    console.log({
      event: 'OPERATIONS_FETCH',
      timestamp: new Date().toISOString(),
    });

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      health,
      telemetry,
      monitor,
      runtime: {
        providers: runtime.providers,
        locks: runtime.locks,
        cache: runtime.cache,
      },
      sessions,
    });
  } catch {
    return res.status(500).json({
      success: false,
      error: 'Erro ao carregar operações.',
    });
  }
});

export default router;
