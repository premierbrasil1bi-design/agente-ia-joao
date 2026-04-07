import axios from 'axios';

const CONFIG = {
  WAHA_URL:
    process.env.WAHA_URL ||
    process.env.WAHA_BASE_URL ||
    process.env.WAHA_API_URL ||
    'http://saas_waha:3099',
  WAHA_API_KEY: process.env.WAHA_API_KEY,
  EVOLUTION_URL: process.env.EVOLUTION_URL || process.env.EVOLUTION_API_URL || 'http://saas_evolution:8080',
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
};

function providerOf(channel) {
  return String(channel?.provider || channel?.type || '').toLowerCase().trim();
}

function instanceOf(channel) {
  return String(channel?.instance || channel?.external_id || '').trim();
}

export async function checkChannelHealth(channel) {
  const provider = providerOf(channel);
  const instance = instanceOf(channel);
  try {
    if (provider === 'waha') {
      const res = await axios.get(`${String(CONFIG.WAHA_URL).replace(/\/$/, '')}/api/sessions`, {
        headers: { 'x-api-key': CONFIG.WAHA_API_KEY },
        timeout: 15000,
      });
      const sessions = Array.isArray(res.data) ? res.data : res?.data?.sessions || [];
      const session = sessions.find((s) => String(s?.name || s?.id || s?.session || '').trim() === instance);
      const status = String(session?.status || session?.state || '').toUpperCase().replace(/-/g, '_');
      return status === 'WORKING' || status === 'CONNECTED' || status === 'OPEN';
    }

    if (provider === 'evolution') {
      const res = await axios.get(`${String(CONFIG.EVOLUTION_URL).replace(/\/$/, '')}/instance/fetchInstances`, {
        headers: { apikey: CONFIG.EVOLUTION_API_KEY },
        timeout: 15000,
      });
      const items = Array.isArray(res.data) ? res.data : res?.data?.instances || res?.data?.data || [];
      return items.some((i) => String(i?.instanceName || i?.name || '').trim() === instance);
    }

    return false;
  } catch (error) {
    console.error('[HEALTH ERROR]', error?.message || error);
    return false;
  }
}
