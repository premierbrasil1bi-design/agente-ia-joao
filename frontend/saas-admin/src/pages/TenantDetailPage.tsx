import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, Badge, Button, Tabs, Skeleton } from "../components/ui";
import {
  adminApi,
  type Tenant,
  type TenantAgent,
  type TenantChannel,
  type TenantUser,
  type TenantUsage,
  type TenantLogRow,
  type TenantBilling,
} from "../api/admin";
import styles from "./TenantDetailPage.module.css";
import { getTenantProvidersDisplay, providerOptions, sanitizeAllowedProviders } from "../utils/tenantProviders";

const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "agents", label: "Agentes" },
  { id: "channels", label: "Canais" },
  { id: "users", label: "Usuários" },
  { id: "usage", label: "Uso" },
  { id: "logs", label: "Logs" },
  { id: "billing", label: "Billing" },
];

export default function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tab, setTab] = useState("overview");

  const [agents, setAgents] = useState<TenantAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [channels, setChannels] = useState<TenantChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [logs, setLogs] = useState<TenantLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [billing, setBilling] = useState<TenantBilling | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [savingTenant, setSavingTenant] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [editForm, setEditForm] = useState({
    nome_empresa: "",
    slug: "",
    plan: "free",
    status: "ativo",
    max_agents: 0,
    max_messages: 0,
    allowed_providers: [] as string[],
  });

  useEffect(() => {
    if (!tenantId) return;
    adminApi.getTenant(tenantId).then((data) => {
      setTenant(data);
      if (data) {
        setEditForm({
          nome_empresa: data.nome_empresa || "",
          slug: data.slug || "",
          plan: data.plan || "free",
          status: data.status || "ativo",
          max_agents: Number(data.max_agents ?? 0),
          max_messages: Number(data.max_messages ?? 0),
          allowed_providers: sanitizeAllowedProviders(data.allowed_providers),
        });
      }
    });
  }, [tenantId]);

  function toggleProvider(provider: string) {
    setEditForm((prev) => {
      const current = new Set(prev.allowed_providers || []);
      if (current.has(provider)) current.delete(provider);
      else current.add(provider);
      return { ...prev, allowed_providers: [...current] };
    });
  }

  async function handleSaveTenant() {
    if (!tenantId) return;
    setSavingTenant(true);
    setSaveError("");
    try {
      const updated = await adminApi.updateTenant(tenantId, {
        name: editForm.nome_empresa,
        slug: editForm.slug,
        plan: editForm.plan,
        status: editForm.status,
        max_agents: Number(editForm.max_agents || 0),
        max_messages: Number(editForm.max_messages || 0),
        allowed_providers: sanitizeAllowedProviders(editForm.allowed_providers),
      });
      setTenant(updated);
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err?.message || "Erro ao salvar tenant.");
    } finally {
      setSavingTenant(false);
    }
  }

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "agents") {
      setAgentsLoading(true);
      adminApi
        .getTenantAgents(tenantId)
        .then(setAgents)
        .catch(() => setAgents([]))
        .finally(() => setAgentsLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "channels") {
      setChannelsLoading(true);
      adminApi
        .getTenantChannels(tenantId)
        .then(setChannels)
        .catch(() => setChannels([]))
        .finally(() => setChannelsLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "users") {
      setUsersLoading(true);
      adminApi
        .getTenantUsers(tenantId)
        .then(setUsers)
        .catch(() => setUsers([]))
        .finally(() => setUsersLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "usage") {
      setUsageLoading(true);
      adminApi
        .getTenantUsage(tenantId)
        .then(setUsage)
        .catch(() => setUsage(null))
        .finally(() => setUsageLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "logs") {
      setLogsLoading(true);
      adminApi
        .getTenantLogs(tenantId)
        .then(setLogs)
        .catch(() => setLogs([]))
        .finally(() => setLogsLoading(false));
    }
  }, [tenantId, tab]);

  useEffect(() => {
    if (!tenantId) return;
    if (tab === "billing") {
      setBillingLoading(true);
      adminApi
        .getTenantBilling(tenantId)
        .then(setBilling)
        .catch(() => setBilling(null))
        .finally(() => setBillingLoading(false));
    }
  }, [tenantId, tab]);

  if (!tenant && tenantId) {
    return (
      <div className={styles.page}>
        <Skeleton height={48} width={300} />
        <Skeleton height={200} width="100%" style={{ marginTop: 24 }} />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className={styles.page}>
        <p>Tenant não encontrado.</p>
        <Link to="/tenants">Voltar para Tenants</Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{tenant.nome_empresa}</h1>
          <p className={styles.subtitle}>
            {tenant.slug} · <Badge variant={tenant.status === "ativo" ? "success" : "default"}>{tenant.status}</Badge>
          </p>
        </div>
        <div className={styles.actions}>
          <Link to={`/tenants/${tenantId}/users`}>
            <Button variant="secondary">Usuários do tenant</Button>
          </Link>
          <Button variant="secondary" onClick={() => setIsEditing((v) => !v)}>
            {isEditing ? "Cancelar edição" : "Editar"}
          </Button>
          {tenant.status === "ativo" ? (
            <Button variant="danger">Suspender</Button>
          ) : (
            <Button>Ativar</Button>
          )}
        </div>
      </div>

      <Tabs tabs={TABS} activeId={tab} onChange={setTab}>
        {tab === "overview" && (
          <Card title="Visão geral">
            <dl className={styles.dl}>
              <dt>Plano</dt>
              <dd>{tenant.plan}</dd>
              <dt>Max agentes</dt>
              <dd>{tenant.max_agents ?? "-"}</dd>
              <dt>Max mensagens</dt>
              <dd>{Number(tenant?.max_messages ?? 0).toLocaleString("pt-BR")}</dd>
              <dt>Agentes no período</dt>
              <dd>{tenant.agents_used_current_period ?? 0}</dd>
              <dt>Mensagens no período</dt>
              <dd>{Number(tenant?.messages_used_current_period ?? 0).toLocaleString("pt-BR")}</dd>
              <dt>Início do ciclo</dt>
              <dd>{tenant.billing_cycle_start?.slice(0, 10) ?? "-"}</dd>
              <dt>Providers liberados</dt>
              <dd>
                <div className={styles.providersWrap}>
                  {getTenantProvidersDisplay(tenant.allowed_providers).map((item) => (
                    <Badge key={item.type} variant={item.badgeVariant} className={styles.providerBadge}>
                      {item.label}
                    </Badge>
                  ))}
                </div>
              </dd>
            </dl>
            {isEditing ? (
              <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Editar tenant</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  <label>
                    <div>Empresa</div>
                    <input
                      value={editForm.nome_empresa}
                      onChange={(e) => setEditForm((p) => ({ ...p, nome_empresa: e.target.value }))}
                    />
                  </label>
                  <label>
                    <div>Slug</div>
                    <input
                      value={editForm.slug}
                      onChange={(e) => setEditForm((p) => ({ ...p, slug: e.target.value }))}
                    />
                  </label>
                  <label>
                    <div>Plano</div>
                    <select
                      value={editForm.plan}
                      onChange={(e) => setEditForm((p) => ({ ...p, plan: e.target.value }))}
                    >
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </label>
                  <label>
                    <div>Status</div>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}
                    >
                      <option value="ativo">Ativo</option>
                      <option value="inativo">Inativo</option>
                      <option value="active">Ativo</option>
                      <option value="inactive">Inativo</option>
                    </select>
                  </label>
                  <label>
                    <div>Max agentes</div>
                    <input
                      type="number"
                      value={editForm.max_agents}
                      onChange={(e) => setEditForm((p) => ({ ...p, max_agents: Number(e.target.value) }))}
                    />
                  </label>
                  <label>
                    <div>Max mensagens</div>
                    <input
                      type="number"
                      value={editForm.max_messages}
                      onChange={(e) => setEditForm((p) => ({ ...p, max_messages: Number(e.target.value) }))}
                    />
                  </label>
                </div>
                <div style={{ marginTop: 16 }}>
                  <strong>Providers de WhatsApp liberados</strong>
                  <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                    {providerOptions().map((provider) => (
                      <label key={provider.value} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={editForm.allowed_providers.includes(provider.value)}
                          onChange={() => toggleProvider(provider.value)}
                        />
                        <span>{provider.label}</span>
                      </label>
                    ))}
                  </div>
                  <small style={{ display: "block", color: "var(--text-muted)", marginTop: 6 }}>
                    Esses providers ficarão disponíveis para os usuários deste tenant conforme o pacote contratado.
                  </small>
                </div>
                {saveError ? <p style={{ color: "var(--danger)", marginTop: 10 }}>{saveError}</p> : null}
                <div style={{ marginTop: 12 }}>
                  <Button onClick={handleSaveTenant} disabled={savingTenant}>
                    {savingTenant ? "Salvando..." : "Salvar alterações"}
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        )}
        {tab === "agents" && (
          <Card title="Agentes">
            {agentsLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : agents.length === 0 ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Slug</th>
                    <th>Descrição</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{a.slug}</td>
                      <td>{a.description ?? "-"}</td>
                      <td>
                        <Badge variant={a.status === "ativo" ? "success" : "default"}>{a.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
        {tab === "channels" && (
          <Card title="Canais">
            {channelsLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : channels.length === 0 ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Agent ID</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.type}</td>
                      <td>
                        <Badge variant={c.status === "online" ? "success" : "default"}>{c.status}</Badge>
                      </td>
                      <td className={styles.mono}>{c.agent_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
        {tab === "users" && (
          <Card title="Usuários">
            {usersLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : users.length === 0 ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Nome</th>
                    <th>Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.name ?? "-"}</td>
                      <td>{u.created_at ? new Date(u.created_at).toLocaleString("pt-BR") : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.placeholder} style={{ marginTop: "1rem" }}>
              <Link to={`/tenants/${tenantId}/users`}>Ver página de usuários do tenant</Link>
            </p>
          </Card>
        )}
        {tab === "usage" && (
          <Card title="Uso">
            {usageLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : !usage ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <div className={styles.cards}>
                <div className={styles.card}>
                  <span className={styles.cardLabel}>Mensagens</span>
                  <span className={styles.cardValue}>{Number(usage.messages_count).toLocaleString("pt-BR")}</span>
                </div>
                <div className={styles.card}>
                  <span className={styles.cardLabel}>Agentes</span>
                  <span className={styles.cardValue}>{usage.agents_count}</span>
                </div>
                <div className={styles.card}>
                  <span className={styles.cardLabel}>Canais</span>
                  <span className={styles.cardValue}>{usage.channels_count}</span>
                </div>
                <div className={styles.card}>
                  <span className={styles.cardLabel}>Plano</span>
                  <span className={styles.cardValue}>{usage.current_plan_limit?.plan ?? "-"}</span>
                </div>
              </div>
            )}
          </Card>
        )}
        {tab === "logs" && (
          <Card title="Logs">
            {logsLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : logs.length === 0 ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Metadados</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={log.id ?? i}>
                      <td>{log.channel_type ?? "usage"}</td>
                      <td className={styles.mono}>
                        {[
                          log.messages_sent != null && `enviadas: ${log.messages_sent}`,
                          log.messages_received != null && `recebidas: ${log.messages_received}`,
                          log.tokens != null && `tokens: ${log.tokens}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "-"}
                      </td>
                      <td>
                        {log.recorded_at
                          ? new Date(log.recorded_at).toLocaleString("pt-BR")
                          : log.created_at
                            ? new Date(log.created_at).toLocaleString("pt-BR")
                            : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
        {tab === "billing" && (
          <Card title="Billing">
            {billingLoading ? (
              <p className={styles.placeholder}>Carregando...</p>
            ) : !billing ? (
              <p className={styles.placeholder}>Nenhum registro encontrado</p>
            ) : (
              <dl className={styles.dl}>
                <dt>Plano</dt>
                <dd>{billing.plan}</dd>
                <dt>Max agentes</dt>
                <dd>{billing.max_agents}</dd>
                <dt>Max mensagens</dt>
                <dd>{Number(billing.max_messages).toLocaleString("pt-BR")}</dd>
                <dt>Mensagens usadas</dt>
                <dd>{Number(billing.messages_count).toLocaleString("pt-BR")}</dd>
                <dt>Agentes usados</dt>
                <dd>{billing.agents_count}</dd>
                <dt>Ativo</dt>
                <dd>
                  <Badge variant={billing.active ? "success" : "default"}>{billing.active ? "Sim" : "Não"}</Badge>
                </dd>
              </dl>
            )}
          </Card>
        )}
      </Tabs>
    </div>
  );
}
