import * as wahaService from '../../services/wahaService.js';
import { SessionAdapter } from './SessionAdapter.js';

function normalizeWahaStatus(raw) {
  const status = String(raw || '').toUpperCase();
  if (status === 'WORKING' || status === 'CONNECTED' || status === 'OPEN') return 'WORKING';
  if (status === 'SCAN_QR_CODE' || status === 'STARTING' || status === 'QR') return 'QR';
  return 'OFFLINE';
}

function asExistsError(err) {
  const st = err?.httpStatus ?? err?.response?.status;
  return st === 404 || st === 400;
}

export const wahaSessionAdapter = {
  ...SessionAdapter,
  async getSession(name) {
    try {
      const out = await wahaService.getSessionStatus(name);
      if (!out?.ok) return { exists: false, status: 'OFFLINE', raw: out };
      const rawStatus = out?.data?.status ?? out?.data?.state ?? out?.data?.session?.status ?? null;
      return {
        exists: true,
        status: normalizeWahaStatus(rawStatus),
        raw: out?.data ?? null,
      };
    } catch (err) {
      if (asExistsError(err)) return { exists: false, status: 'OFFLINE', raw: null };
      throw err;
    }
  },
  async createSession(name) {
    const out = await wahaService.createSession(name);
    if (out?.ok === false) throw new Error(out?.error || 'Falha ao criar sessão WAHA');
    return out;
  },
  async deleteSession(name) {
    const out = await wahaService.deleteSession(name);
    if (out?.ok === false) throw new Error(out?.error || 'Falha ao remover sessão WAHA');
    return out;
  },
  async startSession(name) {
    const out = await wahaService.createSession(name);
    if (out?.ok === false) throw new Error(out?.error || 'Falha ao iniciar sessão WAHA');
    return out;
  },
  async getQRCode(name) {
    const out = await wahaService.getQrCode(name);
    return out?.qr || null;
  },
};
