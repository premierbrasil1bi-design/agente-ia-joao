import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, Badge, Button, Tabs, Skeleton } from "../components/ui";
import { adminApi, type Tenant } from "../api/admin";
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

  useEffect(() => {
    if (!tenantId) return;
    adminApi.getTenant(tenantId).then(setTenant);
  }, [tenantId]);

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
            <p className={styles.placeholder}>Lista de agentes do tenant (integrar API).</p>
          </Card>
        )}
        {tab === "channels" && (
          <Card title="Canais">
            <p className={styles.placeholder}>Canais conectados (WhatsApp, etc.) — integrar API.</p>
          </Card>
        )}
        {tab === "users" && (
          <Card title="Usuários">
            <p className={styles.placeholder}>
              <Link to={`/tenants/${tenantId}/users`}>Ver usuários do tenant</Link>
            </p>
          </Card>
        )}
        {tab === "usage" && (
          <Card title="Uso">
            <p className={styles.placeholder}>Gráfico e histórico de uso — integrar API.</p>
          </Card>
        )}
        {tab === "logs" && (
          <Card title="Logs">
            <p className={styles.placeholder}>Logs do tenant — filtrar por tenant_id na API de logs.</p>
          </Card>
        )}
        {tab === "billing" && (
          <Card title="Billing">
            <p className={styles.placeholder}>Faturas e método de pagamento — integrar API.</p>
          </Card>
        )}
      </Tabs>
    </div>
  );
}
