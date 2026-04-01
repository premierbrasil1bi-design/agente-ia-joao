/**
 * Edge Function: admin-users-manager
 * Cria usuários via Admin API (SaaS). Contrato fixo de resposta; validação de admin e payload.
 *
 * Body JSON: { action: "createUser", email, password, role }
 * Headers: Authorization: Bearer <JWT do chamador (deve ser admin)>
 */

import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = ["admin", "user", "manager"] as const;
type AllowedRole = (typeof allowedRoles)[number];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function okResponse(userId: string, user: Record<string, unknown>, message?: string): Response {
  const body: Record<string, unknown> = {
    success: true,
    userId,
    user,
  };
  if (message != null && message !== "") body.message = message;
  return json(body, 200);
}

function errResponse(code: string, message: string, status: number): Response {
  return json(
    {
      success: false,
      error: { code, message },
    },
    status,
  );
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function isCallerAdmin(user: User | null): boolean {
  if (!user) return false;
  const app = user.app_metadata ?? {};
  const meta = user.user_metadata ?? {};
  const r = app.role ?? meta.role;
  if (r === "admin") return true;
  const roles = app.roles ?? meta.roles;
  if (Array.isArray(roles) && roles.includes("admin")) return true;
  return false;
}

function isAllowedRole(role: string): role is AllowedRole {
  return (allowedRoles as readonly string[]).includes(role);
}

/** Resposta pública do usuário (contrato estável; sem campos sensíveis). */
function toUserPayload(u: User): Record<string, unknown> {
  return {
    id: u.id,
    email: u.email ?? null,
    role:
      (u.user_metadata as Record<string, unknown> | undefined)?.role ??
      (u.app_metadata as Record<string, unknown> | undefined)?.role ??
      null,
    created_at: u.created_at,
    user_metadata: u.user_metadata ?? {},
    app_metadata: u.app_metadata ?? {},
  };
}

function isUserAlreadyExistsError(err: { message?: string; status?: number }): boolean {
  const m = String(err.message || "").toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("user already exists") ||
    m.includes("duplicate") ||
    err.status === 422
  );
}

async function findUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  const perPage = 1000;
  const maxPages = 10;
  while (page <= maxPages) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find((u) => (u.email || "").toLowerCase() === normalized);
    if (found) return found;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errResponse("METHOD_NOT_ALLOWED", "Use POST", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();

  if (!serviceKey) {
    console.error("[ADMIN_CREATE_USER_ERROR]", "SUPABASE_SERVICE_ROLE_KEY não configurado");
    return errResponse(
      "MISSING_SERVICE_CONFIG",
      "SUPABASE_SERVICE_ROLE_KEY não configurado no ambiente da função",
      500,
    );
  }

  if (!supabaseUrl || !anonKey) {
    console.error("[ADMIN_CREATE_USER_ERROR]", "SUPABASE_URL ou SUPABASE_ANON_KEY ausente");
    return errResponse("MISSING_SERVICE_CONFIG", "Configuração Supabase incompleta", 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return errResponse("UNAUTHORIZED", "Authorization Bearer obrigatório", 401);
  }

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: caller },
    error: callerErr,
  } = await supabaseUser.auth.getUser();

  if (callerErr || !caller) {
    return errResponse("UNAUTHORIZED", "Token inválido ou expirado", 401);
  }

  if (!isCallerAdmin(caller)) {
    return errResponse("FORBIDDEN", "Apenas administradores podem criar usuários", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errResponse("INVALID_PAYLOAD", "JSON inválido", 400);
  }

  const action = body.action;
  if (action !== "createUser") {
    return errResponse("INVALID_ACTION", 'Ação não suportada. Use action: "createUser"', 400);
  }

  const email = body.email;
  const password = body.password;
  const role = body.role;

  if (!isNonEmptyString(email) || !isNonEmptyString(password) || !isNonEmptyString(role)) {
    return errResponse(
      "INVALID_PAYLOAD",
      "Campos obrigatórios: email, password, role",
      400,
    );
  }

  const roleNorm = String(role).trim().toLowerCase();
  if (!isAllowedRole(roleNorm)) {
    return errResponse(
      "INVALID_ROLE",
      `role deve ser um de: ${allowedRoles.join(", ")}`,
      400,
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("[ADMIN_CREATE_USER]", {
    email: email.trim().toLowerCase(),
    role: roleNorm,
    requestedBy: caller.id,
  });

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim(),
    password: password,
    email_confirm: true,
    user_metadata: { role: roleNorm },
    app_metadata: { role: roleNorm },
  });

  if (!createError && created?.user) {
    const u = created.user;
    return okResponse(u.id, toUserPayload(u));
  }

  if (createError && isUserAlreadyExistsError(createError)) {
    try {
      const existing = await findUserByEmail(supabaseAdmin, email);
      if (existing) {
        return okResponse(
          existing.id,
          toUserPayload(existing),
          "Usuário já existia; retorno idempotente.",
        );
      }
    } catch (lookupErr) {
      console.error("[ADMIN_CREATE_USER_ERROR]", lookupErr);
      return errResponse(
        "USER_EXISTS_LOOKUP_FAILED",
        "Usuário já existe mas não foi possível carregar o registro.",
        409,
      );
    }
    return errResponse(
      "USER_EXISTS",
      "Usuário já cadastrado com este e-mail.",
      409,
    );
  }

  console.error("[ADMIN_CREATE_USER_ERROR]", createError);
  const upstreamStatus =
    typeof (createError as { status?: number })?.status === "number"
      ? (createError as { status: number }).status
      : 0;
  const httpStatus = upstreamStatus >= 500 ? 502 : 400;
  return errResponse(
    "CREATE_USER_FAILED",
    createError?.message || "Falha ao criar usuário",
    httpStatus,
  );
});
