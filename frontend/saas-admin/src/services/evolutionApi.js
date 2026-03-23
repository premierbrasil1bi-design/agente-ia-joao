const BASE_URL = 'https://evolution.omnia1biai.com.br';

const API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_EVOLUTION_API_KEY) ||
  import.meta.env?.VITE_EVOLUTION_API_KEY ||
  import.meta.env?.NEXT_PUBLIC_EVOLUTION_API_KEY ||
  '';

export async function evolutionFetch(path, options = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: API_KEY,
      ...(options.headers || {}),
    },
  });
}
