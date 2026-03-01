import { useEffect, useState } from "react";
import { Card, Table, TableHead, TableBody, TableRow, Badge, Skeleton } from "../components/ui";
import { adminApi, type UsageRecord } from "../api/admin";
import styles from "./UsagePage.module.css";

export default function UsagePage() {
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getUsage().then((data) => {
      setUsage(data);
      setLoading(false);
    });
  }, []);

  const pct = (used: number, limit: number) =>
    limit ? Math.round((used / limit) * 100) : 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Uso</h1>
      <p className={styles.subtitle}>Consumo por tenant e limites do plano</p>

      <Card>
        {loading ? (
          <div className={styles.skeletonWrap}>
            <Skeleton height={40} width="100%" />
            <Skeleton height={32} width="100%" />
            <Skeleton height={32} width="100%" />
          </div>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <th>Tenant</th>
                <th>Período</th>
                <th>Agentes</th>
                <th>Mensagens</th>
                <th>Status</th>
              </tr>
            </TableHead>
            <TableBody>
              {usage.map((u) => {
                const agentsPct = pct(u.agents_used, u.limits_agents);
                const msgsPct = pct(u.messages_used, u.limits_messages);
                const status = agentsPct >= 90 || msgsPct >= 90 ? "warning" : "success";
                return (
                  <TableRow key={u.tenant_id}>
                    <td>{u.tenant_name}</td>
                    <td>{u.period}</td>
                    <td>
                      {u.agents_used} / {u.limits_agents}
                    </td>
                    <td>
                      {u.messages_used.toLocaleString("pt-BR")} / {u.limits_messages.toLocaleString("pt-BR")}
                    </td>
                    <td>
                      <Badge variant={status}>
                        {agentsPct >= 90 || msgsPct >= 90 ? "Próximo do limite" : "Ok"}
                      </Badge>
                    </td>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && usage.length === 0 && (
          <div className={styles.empty}>Nenhum dado de uso.</div>
        )}
      </Card>
    </div>
  );
}
