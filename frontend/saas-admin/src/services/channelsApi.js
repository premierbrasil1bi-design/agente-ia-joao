const API_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
  import.meta.env?.NEXT_PUBLIC_API_URL ||
  import.meta.env?.VITE_API_BASE_URL ||
  '';

function buildUrl(path) {
  const base = String(API_BASE || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export async function fetchChannels() {
  const res = await fetch(buildUrl('/api/channels'), {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Erro ao buscar canais');
  return res.json();
}

export async function createChannel(data) {
  const res = await fetch(buildUrl('/api/channels'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Erro ao criar canal');
  return res.json();
}
