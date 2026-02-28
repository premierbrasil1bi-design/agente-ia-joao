export async function request(url, options = {}) {
  const token = localStorage.getItem("platform_token");
  const base = import.meta.env.VITE_API_BASE_URL;
  const headers = {
    ...(options.headers || {}),
    Authorization: token ? `Bearer ${token}` : undefined,
    "Content-Type": "application/json",
  };
  const res = await fetch(base + url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("platform_token");
    localStorage.removeItem("platform_user");
    window.location = "/login";
    return;
  }
  return res;
}
