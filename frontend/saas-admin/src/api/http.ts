const BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || "";

const TOKEN_KEYS = ["platform_token", "adminToken", "token", "accessToken"] as const;

export function getAuthToken(): string | null {
  for (const key of TOKEN_KEYS) {
    const value = localStorage.getItem(key);
    if (value) return value;
  }
  return null;
}

export function clearAuthTokens(): void {
  for (const key of TOKEN_KEYS) {
    localStorage.removeItem(key);
  }
}

type RequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: any;
  headers?: Record<string, string>;
};

function buildUrl(path: string): string {
  if (!path) return BASE_URL;
  if (path.startsWith("http")) return path;

  const base = String(BASE_URL || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export async function request<T = any>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = buildUrl(path);
  const token = getAuthToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let body: any = options.body;

  if (
    body !== undefined &&
    body !== null &&
    typeof body === "object" &&
    !(body instanceof FormData)
  ) {
    body = JSON.stringify(body);
  }

  const resp = await fetch(url, {
    ...options,
    headers,
    body,
  });

  if (resp.status === 401) {
    console.warn("Token inválido ou expirado");
  }

  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const errJson = await resp.json();
      message = errJson?.error || errJson?.message || message;
    } catch {
      // ignore
    }
    const error: any = new Error(message);
    error.status = resp.status;
    throw error;
  }

  if (resp.status === 204) return undefined as unknown as T;

  const contentType = resp.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await resp.json()) as T;
  }

  return (await resp.text()) as unknown as T;
}
