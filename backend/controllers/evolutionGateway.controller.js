/**
 * Gateway Evolution — respostas JSON; erros sem vazar secrets.
 */

import * as evolutionProxyService from '../services/evolutionProxyService.js';
import * as channelConnectionService from '../services/channelConnection.service.js';

export async function listInstances(req, res) {
  try {
    const data = await evolutionProxyService.fetchInstances();
    const instanceNames = [...channelConnectionService.collectInstanceNamesFromFetch(data)].sort();
    res.status(200).json({ evolution: data, instanceNames });
  } catch (err) {
    console.error('[EVOLUTION] gateway GET /instances', err.message, err.response?.status || err.code || '');
    const status = err.response?.status >= 400 && err.response?.status < 600 ? err.response.status : 502;
    res.status(status).json({
      error: err.message || 'Erro ao listar instâncias na Evolution.',
      details: err.response?.data ?? null,
    });
  }
}

export async function createInstance(req, res) {
  try {
    const data = await evolutionProxyService.createInstance(req.body || {});
    evolutionProxyService.syncInstancesWithDatabase().catch((e) => {
      console.warn('[EVOLUTION] pós-create syncInstancesWithDatabase:', e.message);
    });
    res.status(200).json(data);
  } catch (err) {
    console.error('[EVOLUTION] gateway POST /instance', err.message, err.response?.status || err.code || '');
    if (err.code === 'VALIDATION' || err.code === 'EVOLUTION_NOT_CONFIGURED') {
      return res.status(400).json({ error: err.message });
    }
    const status = err.response?.status >= 400 && err.response?.status < 600 ? err.response.status : 502;
    res.status(status).json({
      error: err.message || 'Erro ao criar instância na Evolution.',
      details: err.response?.data ?? null,
    });
  }
}

export async function getQrCode(req, res) {
  try {
    const instance = req.params.instance;
    const data = await evolutionProxyService.getQRCode(instance);
    res.status(200).json(data);
  } catch (err) {
    console.error('[EVOLUTION] gateway GET /qrcode', err.message, err.response?.status || err.code || '');
    if (err.code === 'VALIDATION' || err.code === 'EVOLUTION_NOT_CONFIGURED') {
      return res.status(400).json({ error: err.message });
    }
    const status = err.response?.status === 404 ? 404 : err.response?.status >= 400 ? err.response.status : 502;
    res.status(status).json({
      error: err.message || 'Erro ao obter QR Code na Evolution.',
      details: err.response?.data ?? null,
    });
  }
}
