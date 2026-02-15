/**
 * Configuração de ambiente – base URL da API.
 * Em desenvolvimento: use .env.local (ex: VITE_API_URL=http://localhost:3000).
 * Em produção (Vercel): use .env.production ou variável no dashboard (VITE_API_URL=https://seu-backend.com).
 */

export const getApiBaseUrl = () => import.meta.env.VITE_API_URL || '';
