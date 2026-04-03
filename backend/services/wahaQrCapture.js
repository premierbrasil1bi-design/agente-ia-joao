/**
 * Captura QR do WAHA a partir do stdout do container Docker (docker logs -f).
 * A API REST do WAHA pode não expor o QR; o engine costuma logar data URL em base64.
 *
 * Requer Docker CLI no PATH e, se o backend rodar em container, montar o socket:
 *   volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
 *
 * Ative com WAHA_QR_LOG_CAPTURE=true (ou 1/yes).
 * Container: WAHA_DOCKER_CONTAINER (padrão: saas_waha).
 *
 * Snapshot pontual (docker logs --tail) — fallback quando REST 404 e sem stream ativo.
 * WAHA_QR_DOCKER_TAIL_SNAPSHOT=false desliga o snapshot.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

const QR_DATA_URL_INLINE_RE = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/gi;

/** Linhas típicas de QR ASCII no terminal (█▀▄ e blocos Unicode). */
const QR_ASCII_LINE_RE = /[\u2588\u2580\u2584▀▄█■□▓▒░]/;

function extractAsciiQrBlockFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  const marked = lines.map((line, i) => (QR_ASCII_LINE_RE.test(line) ? i : -1));
  const indices = marked.filter((i) => i >= 0);
  if (indices.length === 0) return null;

  let bestStart = indices[0];
  let bestLen = 1;
  let runStart = indices[0];
  let runLen = 1;
  for (let k = 1; k < indices.length; k++) {
    if (indices[k] === indices[k - 1] + 1) {
      runLen++;
    } else {
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
      runStart = indices[k];
      runLen = 1;
    }
  }
  if (runLen > bestLen) {
    bestLen = runLen;
    bestStart = runStart;
  }
  const slice = lines.slice(bestStart, bestStart + bestLen);
  const joined = slice.join('\n').trim();
  if (joined.length < 12) return null;
  return joined;
}

function falsyEnv(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '0' || s === 'false' || s === 'no' || s === 'off';
}

export function isWahaDockerTailSnapshotEnabled() {
  return !falsyEnv(process.env.WAHA_QR_DOCKER_TAIL_SNAPSHOT);
}

/**
 * Uma leitura pontual dos logs do container (sem -f): data URL nos logs ou bloco ASCII do QR.
 * @returns {Promise<{ imageDataUrl: string | null, ascii: string | null }>}
 */
export async function getQrSnapshotFromDockerLogs() {
  const out = { imageDataUrl: null, ascii: null };
  if (!isWahaDockerTailSnapshotEnabled()) {
    return out;
  }
  const container = String(process.env.WAHA_DOCKER_CONTAINER || 'saas_waha').trim() || 'saas_waha';
  const dockerBin = String(process.env.WAHA_DOCKER_BINARY || 'docker').trim() || 'docker';
  const tailN = Math.min(
    20000,
    Math.max(200, parseInt(process.env.WAHA_DOCKER_LOGS_TAIL || '800', 10) || 800)
  );
  try {
    const { stdout, stderr } = await execAsync(`${dockerBin} logs --tail ${tailN} ${container}`, {
      maxBuffer: 12 * 1024 * 1024,
      timeout: 25000,
      env: process.env,
    });
    const combined = `${stdout || ''}\n${stderr || ''}`;
    let lastUrl = null;
    QR_DATA_URL_INLINE_RE.lastIndex = 0;
    let m;
    while ((m = QR_DATA_URL_INLINE_RE.exec(combined)) !== null) {
      lastUrl = m[0];
    }
    if (lastUrl) {
      out.imageDataUrl = lastUrl;
      return out;
    }
    const ascii = extractAsciiQrBlockFromText(combined);
    if (ascii) {
      out.ascii = ascii;
    }
  } catch (e) {
    console.warn('[WAHA_QR_DOCKER_TAIL] falhou:', e?.message || e);
  }
  return out;
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
