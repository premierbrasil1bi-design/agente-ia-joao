export async function connect(config = {}) {
  const baseUrl = String(process.env.ZAPI_BASE_URL || 'https://api.z-api.io').replace(/\/$/, '');
  const instanceId = String(config.instanceId || '').trim();
  if (!instanceId) {
    throw new Error('Z-API: instanceId é obrigatório');
  }

  const qr = `${baseUrl}/instances/${encodeURIComponent(instanceId)}/qr-code`;

  return {
    provider: 'zapi',
    qr,
    instanceId,
  };
}
