import axios from 'axios';

const env = typeof process !== 'undefined' ? process.env || {} : {};
const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env || {} : {};

const WAHA_BASE_URL =
  env.REACT_APP_WAHA_URL ||
  viteEnv.VITE_WAHA_URL ||
  '';

const WAHA_API_KEY =
  env.REACT_APP_WAHA_API_KEY ||
  viteEnv.VITE_WAHA_API_KEY ||
  '';

export const wahaApi = axios.create({
  baseURL: WAHA_BASE_URL,
  headers: {
    'X-Api-Key': WAHA_API_KEY,
    'Content-Type': 'application/json',
  },
});

wahaApi.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  config.headers['X-Api-Key'] = WAHA_API_KEY;
  config.headers['Content-Type'] = 'application/json';
  return config;
});

wahaApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      console.error('[WAHA] Unauthorized - missing API key');
    }
    return Promise.reject(error);
  },
);

