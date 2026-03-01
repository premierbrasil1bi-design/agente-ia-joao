import { useEffect, useState } from "react";
import { Card, Badge, Button } from "../components/ui";
import { adminApi, type DashboardStats } from "../api/admin";
import styles from "./DashboardPage.module.css";

export default function DashboardPage() {

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; level: string; message: string }[]>([]);

  const safeStats = {
    tenants: stats?.tenants ?? 0,
    activeTenants: stats?.activeTenants ?? 0,
    totalAgents: stats?.totalAgents ?? 0,
    totalMessages: stats?.totalMessages ?? 0,
  };

  useEffect(() => {
    adminApi.getStats().then(setStats);
    setAlerts([
      { id: "1", level: "warning", message: "Tenant Beta Corp próximo do limite de mensagens (80% do plano Free)." },
      { id: "2", level: "info", message: "Novo tenant criado: Gamma Ltda." },
    ]);
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.cards}>
        <Card>
          <span className={styles.cardLabel}>Tenants</span>
          <span className={styles.cardValue}>
            {safeStats.tenants}
          </span>
        </Card>

        <Card>
          <span className={styles.cardLabel}>Ativos</span>
          <span className={styles.cardValue}>
            {safeStats.activeTenants}
          </span>
        </Card>

        <Card>
          <span className={styles.cardLabel}>Total agentes</span>
          <span className={styles.cardValue}>
            {Number(stats?.totalAgents ?? 0).toLocaleString("pt-BR")}
          </span>
        </Card>

        <Card>
          <span className={styles.cardLabel}>Mensagens (período)</span>
          <span className={styles.cardValue}>
            {Number(stats?.totalMessages ?? 0).toLocaleString("pt-BR")}
          </span>
        </Card>
      </div>

      <div className={styles.chartPlaceholder}>
        <Card title="Uso mensal (placeholder)">
          <div className={styles.chartBox}>
            Gráfico de uso será integrado aqui (chart lib ou API).
          </div>
        </Card>
      </div>

      <Card title="Alertas" className={styles.alertsCard}>
        <ul className={styles.alertList}>
          {alerts.map((a) => (
            <li key={a.id} className={styles.alertItem}>
              <Badge variant={a.level === "warning" ? "warning" : "info"}>{a.level}</Badge>
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
        <Button variant="ghost" className={styles.alertBtn}>Ver todos os alertas</Button>
      </Card>
    </div>
  );
}
