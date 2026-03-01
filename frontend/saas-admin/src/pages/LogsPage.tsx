import { useEffect, useState } from "react";
import { Card, Table, TableHead, TableBody, TableRow, Badge, Input, Select, Button, Skeleton } from "../components/ui";
import { adminApi, type LogEntry } from "../api/admin";
import styles from "./LogsPage.module.css";

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");

  useEffect(() => {
    adminApi.getLogs().then((data) => {
      setLogs(data);
      setLoading(false);
    });
  }, []);

  const filtered = logs.filter((l) => {
    const matchSearch = !search || l.message.toLowerCase().includes(search.toLowerCase());
    const matchLevel = !level || l.level === level;
    return matchSearch && matchLevel;
  });

  const levelVariant = (l: string) =>
    l === "error" ? "danger" : l === "warning" ? "warning" : "info";

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Logs</h1>
      <p className={styles.subtitle}>Busca e filtros de auditoria</p>

      <Card>
        <div className={styles.toolbar}>
          <Input
            placeholder="Buscar na mensagem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
          <Select
            options={[
              { value: "", label: "Todos os níveis" },
              { value: "info", label: "Info" },
              { value: "warning", label: "Warning" },
              { value: "error", label: "Error" },
            ]}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className={styles.select}
          />
          <Button variant="secondary">Aplicar</Button>
        </div>
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
                <th>Data/Hora</th>
                <th>Nível</th>
                <th>Mensagem</th>
                <th>Tenant</th>
                <th>Ação</th>
              </tr>
            </TableHead>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <td>{new Date(l.timestamp).toLocaleString("pt-BR")}</td>
                  <td>
                    <Badge variant={levelVariant(l.level)}>{l.level}</Badge>
                  </td>
                  <td>{l.message}</td>
                  <td>{l.tenant_id ?? "-"}</td>
                  <td>{l.action ?? "-"}</td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && filtered.length === 0 && (
          <div className={styles.empty}>Nenhum log encontrado.</div>
        )}
      </Card>
    </div>
  );
}
