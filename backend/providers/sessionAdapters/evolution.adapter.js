import * as evolutionService from '../../services/evolutionService.js';
import { extractQrPayload, toQrDataUrl } from '../../utils/extractQrPayload.js';
import { SessionAdapter } from './SessionAdapter.js';

function normalizeEvolutionStatus(raw) {
  const status = String(raw || '').toUpperCase();
  if (status === 'WORKING' || status === 'OPEN' || status === 'CONNECTED') return 'WORKING';
  if (status === 'CONNECTING' || status === 'QR' || status === 'QRCODE' || status === 'PENDING') return 'QR';
  return 'OFFLINE';
}

function isConflict(err) {
  const st = err?.response?.status ?? err?.httpStatus;
  return st === 409 || st === 422 || String(err?.message || '').toLowerCase().includes('exists');
}

function isNotFound(err) {
  const st = err?.response?.status ?? err?.httpStatus;
  return st === 404;
}

export const evolutionSessionAdapter = {
  ...SessionAdapter,
  async getSession(name) {
    try {
      const out = await evolutionService.getStatus(name);
      const rawStatus = out?.status ?? out?.state ?? out?.instance?.state ?? null;
      return {
        exists: true,
        status: normalizeEvolutionStatus(rawStatus),
        raw: out,
      };
    } catch (err) {
      if (isNotFound(err)) return { exists: false, status: 'OFFLINE', raw: null };
      throw err;
    }
  },
  async createSession(name) {
    try {
      return await evolutionService.createInstance(name);
    } catch (err) {
      if (isConflict(err)) return { exists: true };
      throw err;
    }
  },
  async deleteSession(name) {
    return evolutionService.deleteInstance(name);
  },
  async startSession(name) {
    return evolutionService.connectInstance(name, { reset: false });
  },
  async getQRCode(name) {
    const raw = await evolutionService.getQRCode(name);
    const payload = extractQrPayload(raw);
    return toQrDataUrl(payload) || payload || null;
  },
};
