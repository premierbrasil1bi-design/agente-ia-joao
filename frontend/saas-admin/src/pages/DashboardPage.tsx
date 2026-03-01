import { useEffect, useState } from "react";
import { Card, Badge, Button, Skeleton } from "../components/ui";
import { adminApi, type DashboardStats } from "../api/admin";
import styles from "./DashboardPage.module.css";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; level: string; message: string }[]>([]);

  useEffect(() => {
    adminApi.getStats().then(setStats);
    setAlerts([
      { id: "1", level: "warning", message: "Tenant Beta Corp próximo do limite de mensagens (80% do plano Free)." },
      { id: "2", level: "info", message: "Novo tenant criado: Gamma Ltda." },
    ]);
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Dashboard</h1>
      <p className={styles.subtitle}>Visão geral do OMNIA AI Admin</p>

      {!stats ? (
        <div className={styles.cards}>
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <Skeleton height={24} width="60%" />
              <Skeleton height={32} width="40%" style={{ marginTop: 8 }} />
            </Card>
          ))}
        </div>
      ) : (
        <div className={styles.cards}>
          <Card>
            <span className={styles.cardLabel}>Tenants</span>
            <span className={styles.cardValue}>{stats.tenants}</span>
          </Card>
          <Card>
            <span className={styles.cardLabel}>Ativos</span>
            <span className={styles.cardValue}>{stats.activeTenants}</span>
          </Card>
          <Card>
            <span className={styles.cardLabel}>Total agentes</span>
            <span className={styles.cardValue}>{stats.totalAgents}</span>
          </Card>
          <Card>
            <span className={styles.cardLabel}>Mensagens (período)</span>
            <span className={styles.cardValue}>{stats.totalMessages.toLocaleString("pt-BR")}</span>
          </Card>
        </div>
      )}

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
