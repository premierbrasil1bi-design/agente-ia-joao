import { request, getAuthToken } from "./http";

export interface Tenant {
  id: string;
  nome_empresa: string;
  slug: string;
  plan: string;
  status: string;
  max_agents?: number;
  max_messages?: number;
  agents_used_current_period?: number;
  messages_used_current_period?: number;
  billing_cycle_start?: string;
  created_at?: string;
}

export interface DashboardStats {
  tenants: number;
  totalAgents: number;
  totalMessages: number;
  activeTenants: number;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  price: number;
  description?: string;
  max_agents?: number;
  max_messages?: number;
}

export interface UsageRecord {
  tenant_id: string;
  tenant_name: string;
  period: string;
  agents_used: number;
  messages_used: number;
  limits_agents: number;
  limits_messages: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  tenant_id?: string;
  action?: string;
}

export interface TenantAgent {
  id: string;
  tenant_id: string;
  client_id?: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface TenantChannel {
  id: string;
  tenant_id: string;
  agent_id: string;
  type: string;
  name: string;
  config?: Record<string, unknown>;
  status: string;
  is_active?: boolean;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  email: string;
  name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TenantUsage {
  messages_count: number;
  agents_count: number;
  channels_count: number;
  current_plan_limit: {
    max_agents: number;
    max_messages: number;
    plan: string;
  };
}

export interface TenantLogRow {
  id?: string;
  tenant_id?: string;
  agent_id?: string;
  channel_id?: string;
  channel_type?: string;
  messages_sent?: number;
  messages_received?: number;
  tokens?: number;
  estimated_cost?: number;
  recorded_at?: string;
  created_at?: string;
}

export interface TenantBilling {
  tenant_id: string;
  plan: string;
  max_agents: number;
  max_messages: number;
  messages_count: number;
  agents_count: number;
  active: boolean;
}

/* Mocks for when API is not available */
const MOCK_TENANTS: Tenant[] = [
  {
    id: "1",
    nome_empresa: "Empresa Alpha",
    slug: "empresa-alpha",
    plan: "pro",
    status: "ativo",
    max_agents: 10,
    max_messages: 5000,
    agents_used_current_period: 3,
    messages_used_current_period: 1200,
    billing_cycle_start: "2025-01-01",
  },
  {
    id: "2",
    nome_empresa: "Beta Corp",
    slug: "beta-corp",
    plan: "free",
    status: "ativo",
    max_agents: 2,
    max_messages: 500,
    agents_used_current_period: 1,
    messages_used_current_period: 80,
    billing_cycle_start: "2025-01-15",
  },
];

const MOCK_PLANS: Plan[] = [
  { id: "free", name: "Free", slug: "free", price: 0, description: "Até 2 agentes, 500 msgs/mês", max_agents: 2, max_messages: 500 },
  { id: "pro", name: "Pro", slug: "pro", price: 99, description: "Até 10 agentes, 5k msgs/mês", max_agents: 10, max_messages: 5000 },
  { id: "enterprise", name: "Enterprise", slug: "enterprise", price: 299, description: "Ilimitado", max_agents: 999, max_messages: 999999 },
];

async function withFallback<T>(fn: () => Promise<T>, mock: T): Promise<T> {
  try {
    if (!getAuthToken()) return mock;
    return await fn();
  } catch {
    return mock;
  }
}

export const adminApi = {
  async login(email: string, password: string): Promise<{ token: string; admin: { email: string } }> {
    return request<{ token: string; admin: { email: string } }>("/api/global-admin/login", {
      method: "POST",
      body: { email, password },
    });
  },

  async getStats(): Promise<DashboardStats> {
    return withFallback(
      () => request<DashboardStats>("/api/global-admin/stats"),
      {
        tenants: 12,
        totalAgents: 45,
        totalMessages: 125000,
        activeTenants: 10,
      }
    );
  },

  async getTenants(): Promise<Tenant[]> {
    return withFallback(
      () => request<Tenant[]>("/api/global-admin/tenants"),
      MOCK_TENANTS
    );
  },

  async getTenant(id: string): Promise<Tenant | null> {
    return withFallback(
      async () => request<Tenant>(`/api/global-admin/tenants/${id}`),
      MOCK_TENANTS.find((t) => t.id === id) ?? null
    );
  },

  async getPlans(): Promise<Plan[]> {
    return withFallback(
      () => request<Plan[]>("/api/global-admin/plans"),
      MOCK_PLANS
    );
  },

  async getUsage(): Promise<UsageRecord[]> {
    return withFallback(
      () => request<UsageRecord[]>("/api/global-admin/usage"),
      MOCK_TENANTS.map((t) => ({
        tenant_id: t.id,
        tenant_name: t.nome_empresa,
        period: "2025-01",
        agents_used: t.agents_used_current_period ?? 0,
        messages_used: t.messages_used_current_period ?? 0,
        limits_agents: t.max_agents ?? 0,
        limits_messages: t.max_messages ?? 0,
      }))
    );
  },

  async getLogs(_params?: { page?: number; level?: string; tenant_id?: string }): Promise<LogEntry[]> {
    return withFallback(
      () => request<LogEntry[]>("/api/global-admin/logs"),
      [
        { id: "1", timestamp: new Date().toISOString(), level: "info", message: "Login admin", action: "login" },
        { id: "2", timestamp: new Date().toISOString(), level: "info", message: "Tenant criado", tenant_id: "1", action: "tenant.create" },
      ]
    );
  },

  getTenantAgents(tenantId: string): Promise<TenantAgent[]> {
    return request<TenantAgent[]>(`/api/global-admin/tenants/${tenantId}/agents`);
  },

  getTenantChannels(tenantId: string): Promise<TenantChannel[]> {
    return request<TenantChannel[]>(`/api/global-admin/tenants/${tenantId}/channels`);
  },

  getTenantUsers(tenantId: string): Promise<TenantUser[]> {
    return request<TenantUser[]>(`/api/global-admin/tenants/${tenantId}/users`);
  },

  getTenantUsage(tenantId: string): Promise<TenantUsage> {
    return request<TenantUsage>(`/api/global-admin/tenants/${tenantId}/usage`);
  },

  getTenantLogs(tenantId: string): Promise<TenantLogRow[]> {
    return request<TenantLogRow[]>(`/api/global-admin/tenants/${tenantId}/logs`);
  },

  getTenantBilling(tenantId: string): Promise<TenantBilling> {
    return request<TenantBilling>(`/api/global-admin/tenants/${tenantId}/billing`);
  },
};
