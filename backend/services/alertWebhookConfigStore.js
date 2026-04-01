const webhookConfigStore = new Map();
const MIN_SECRET_LENGTH = 12;

export function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidWebhookSecret(secret) {
  if (secret == null || secret === '') return true;
  return String(secret).trim().length >= MIN_SECRET_LENGTH;
}

export function setWebhookConfig({ tenantId, url, isActive = true, secret = null }) {
  const normalizedSecret = secret == null || String(secret).trim() === '' ? null : String(secret);
  const record = {
    tenantId: String(tenantId),
    url: String(url).trim(),
    isActive: Boolean(isActive),
    secret: normalizedSecret,
    updatedAt: new Date().toISOString(),
  };
  webhookConfigStore.set(record.tenantId, record);
  return record;
}

export function getWebhookConfig(tenantId) {
  return webhookConfigStore.get(String(tenantId)) || null;
}

export function sanitizeWebhookConfig(config) {
  if (!config) return null;
  return {
    tenantId: config.tenantId,
    url: config.url,
    isActive: config.isActive,
    hasSecret: Boolean(config.secret),
    updatedAt: config.updatedAt,
  };
}

