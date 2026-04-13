import axios from 'axios';

function resolveBaseUrl() {
  return String(
    process.env.WAHA_BASE_URL || process.env.WAHA_API_URL || process.env.WAHA_URL || '',
  ).trim().replace(/\/$/, '');
}

function buildHeaders() {
  return {
    'x-api-key': String(process.env.WAHA_API_KEY || '').trim(),
    'Content-Type': 'application/json',
  };
}

async function createDefaultSession(baseURL, headers) {
  await axios.post(
    `${baseURL}/api/sessions`,
    { name: 'default' },
    { headers },
  );
}

async function startDefaultSession(baseURL, headers) {
  await axios.post(
    `${baseURL}/api/sessions/default/start`,
    {},
    { headers },
  );
}

async function recreateDefaultSession(baseURL, headers) {
  try {
    await axios.delete(`${baseURL}/api/sessions/default`, { headers });
  } catch {
    // Ignora falha no delete para manter fallback resiliente.
  }

  await createDefaultSession(baseURL, headers);
  await startDefaultSession(baseURL, headers);
}

export default async function bootstrapWahaSession() {
  const baseURL = resolveBaseUrl();
  const headers = buildHeaders();

  if (!baseURL) {
    console.warn('[WAHA][BOOTSTRAP] WAHA_BASE_URL/WAHA_API_URL não definido; bootstrap ignorado.');
    return;
  }

  try {
    console.log('[WAHA][BOOTSTRAP] Verificando sessão "default"...');

    try {
      const res = await axios.get(`${baseURL}/api/sessions/default`, { headers });
      console.log('[WAHA][BOOTSTRAP] Sessão encontrada:', res?.data?.status ?? null);
    } catch {
      console.log('[WAHA][BOOTSTRAP] Sessão não existe; criando...');
      await createDefaultSession(baseURL, headers);
    }

    console.log('[WAHA][BOOTSTRAP] Iniciando sessão "default"...');
    await startDefaultSession(baseURL, headers);
    console.log('[WAHA][BOOTSTRAP] Sessão iniciada com sucesso.');
  } catch (error) {
    console.error('[WAHA][BOOTSTRAP] Erro ao iniciar sessão:', error?.message || String(error));

    try {
      console.log('[WAHA][BOOTSTRAP] Tentando recriar sessão...');
      await recreateDefaultSession(baseURL, headers);
      console.log('[WAHA][BOOTSTRAP] Sessão recriada com sucesso.');
    } catch (fallbackError) {
      console.error(
        '[WAHA][BOOTSTRAP] Falha total ao recuperar sessão:',
        fallbackError?.message || String(fallbackError),
      );
    }
  }
}
