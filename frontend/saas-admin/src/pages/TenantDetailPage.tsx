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

  useEffect(() => {
    if (!tenantId) return;
    adminApi.getTenant(tenantId).then(setTenant);
  }, [tenantId]);

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
          <Button variant="secondary">Editar</Button>
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
            </dl>
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
