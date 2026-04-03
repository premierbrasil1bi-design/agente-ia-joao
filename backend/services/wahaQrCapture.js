/**
 * Captura QR do WAHA a partir do stdout do container Docker (docker logs -f).
 * A API REST do WAHA pode não expor o QR; o engine costuma logar data URL em base64.
 *
 * Requer Docker CLI no PATH e, se o backend rodar em container, montar o socket:
 *   volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
 *
 * Ative com WAHA_QR_LOG_CAPTURE=true (ou 1/yes).
 * Container: WAHA_DOCKER_CONTAINER (padrão: saas_waha).
 */

import { spawn } from 'child_process';

let currentQr = null;
let logChild = null;
let lastEmittedQr = null;

const QR_DATA_URL_RE = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/gi;

const MAX_BUFFER = 1_500_000;

function truthyEnv(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function isWahaQrLogCaptureEnabled() {
  return truthyEnv(process.env.WAHA_QR_LOG_CAPTURE);
}

export function getCurrentQr() {
  return currentQr;
}

function applyQrFromLog(match) {
  if (!match || match === currentQr) return;
  currentQr = match;
  if (match === lastEmittedQr) return;
  lastEmittedQr = match;
  try {
    globalThis.io?.emit('waha_qr', currentQr);
  } catch {
    /* ignore */
  }
  console.log('[WAHA_QR_CAPTURE] QR capturado (%d caracteres)', currentQr.length);
}

function scanChunk(buffer) {
  let m;
  let last = null;
  QR_DATA_URL_RE.lastIndex = 0;
  while ((m = QR_DATA_URL_RE.exec(buffer)) !== null) {
    last = m[0];
  }
  if (last) applyQrFromLog(last);
}

function attachLogStream() {
  const container = String(process.env.WAHA_DOCKER_CONTAINER || 'saas_waha').trim() || 'saas_waha';
  const dockerBin = String(process.env.WAHA_DOCKER_BINARY || 'docker').trim() || 'docker';

  const args = ['logs', '-f', '--tail', '8000', container];
  const child = spawn(dockerBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  logChild = child;

  let buf = '';

  const onData = (chunk) => {
    buf += chunk.toString('utf8');
    if (buf.length > MAX_BUFFER) {
      buf = buf.slice(-MAX_BUFFER);
    }
    scanChunk(buf);
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (err) => {
    console.error('[WAHA_QR_CAPTURE] spawn docker:', err.message || err);
  });

  child.on('close', (code, signal) => {
    logChild = null;
    console.warn('[WAHA_QR_CAPTURE] docker logs encerrado (code=%s signal=%s)', code, signal);
    if (!isWahaQrLogCaptureEnabled()) return;
    setTimeout(() => {
      if (isWahaQrLogCaptureEnabled() && !logChild) {
        console.log('[WAHA_QR_CAPTURE] reiniciando leitura de logs…');
        attachLogStream();
      }
    }, 5000);
  });
}

export function startWahaQrLogCapture() {
  if (!isWahaQrLogCaptureEnabled()) {
    return;
  }
  if (logChild) {
    return;
  }
  console.log('[WAHA_QR_CAPTURE] Iniciando docker logs -f (WAHA_DOCKER_CONTAINER=%s)', process.env.WAHA_DOCKER_CONTAINER || 'saas_waha');
  attachLogStream();
}

export function stopWahaQrLogCapture() {
  if (logChild && !logChild.killed) {
    try {
      logChild.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  logChild = null;
}
