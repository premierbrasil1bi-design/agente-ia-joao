export function getApiBaseUrl() {
  const b = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  return String(b || '').replace(/\/$/, '');
}
