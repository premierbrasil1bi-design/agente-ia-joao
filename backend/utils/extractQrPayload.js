/**
 * Extrai string de QR (base64, data URL ou URL) da resposta da Evolution API (vários formatos/versões).
 * @returns {string|null}
 */
export function extractQrPayload(response, visited = new WeakSet()) {
  if (response == null) return null;

  if (typeof response === 'string') {
    const t = response.trim();
    return t || null;
  }

  if (typeof response !== 'object') return null;
  if (visited.has(response)) return null;
  visited.add(response);

  if (Array.isArray(response)) {
    for (const item of response) {
      const r = extractQrPayload(item, visited);
      if (r) return r;
    }
    return null;
  }

  const d = response.data;
  const flat = [
    response.base64,
    response.qrcode,
    response.qr,
    typeof d === 'string' ? d : null,
    typeof d === 'object' && d != null ? d.base64 : null,
    typeof d === 'object' && d != null ? d.qrcode : null,
    typeof d === 'object' && d != null ? d.qr : null,
    response.instance?.qrcode,
    response.instance?.base64,
    response.instance?.qr,
    response.code,
    response.pairingCode,
  ];

  for (const c of flat) {
    if (c == null) continue;
    if (typeof c === 'string') {
      const t = c.trim();
      if (t) return t;
    } else if (typeof c === 'object') {
      const nested = extractQrPayload(c, visited);
      if (nested) return nested;
    }
  }

  for (const key of Object.keys(response)) {
    const val = response[key];
    if (val != null && typeof val === 'object') {
      const result = extractQrPayload(val, visited);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Normaliza para uso em <img src> — data:image/png;base64,... ou URL http(s).
 * @returns {string|null}
 */
export function toQrDataUrl(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith('data:image/')) return s;
  if (/^https?:\/\//i.test(s)) return s;

  const b64 = s.replace(/^data:image\/[\w+]+;base64,/i, '').trim();
  if (b64.length < 12) return null;
  return `data:image/png;base64,${b64}`;
}
