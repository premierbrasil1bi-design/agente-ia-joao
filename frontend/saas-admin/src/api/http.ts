const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://api.omnia1biai.com.br";
const TOKEN_KEY = "platform_token";
const USER_KEY = "platform_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.location.href = "/login";
}

export type RequestOptions = RequestInit & {
  body?: Record<string, unknown> | string;
};

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const body =
    typeof options.body === "object" && options.body !== null && !(options.body instanceof FormData)
      ? JSON.stringify(options.body)
      : (options.body as BodyInit | undefined);

  const res = await fetch(url, { ...options, headers, body });
  if (res.status === 401) {
    clearAuth();
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? `Erro ${res.status}`);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
