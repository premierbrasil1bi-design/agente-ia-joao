const ALLOWED_RECONNECT_ROLES = new Set(["SUPER_ADMIN", "SUPPORT", "GLOBAL_ADMIN"]);

export function canReconnectProvider(user) {
  const role = String(user?.role || "").toUpperCase().trim();
  return ALLOWED_RECONNECT_ROLES.has(role);
}

