import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Table, TableHead, TableBody, TableRow, Badge, Button, Skeleton, Input } from "../components/ui";
import { adminApi, type Tenant } from "../api/admin";
import styles from "./TenantsListPage.module.css";

export default function TenantsListPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    adminApi.getTenants().then((data) => {
      setTenants(data);
      setLoading(false);
    });
  }, []);

  const filtered = tenants.filter(
    (t) =>
      t.nome_empresa.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase())
  );

  const statusVariant = (s: string) => (s === "ativo" ? "success" : "default");

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Tenants</h1>
          <p className={styles.subtitle}>Empresas e uso por plano</p>
        </div>
        <Link to="/tenants/new">
          <Button>Novo tenant</Button>
        </Link>
      </div>

      <Card>
        <div className={styles.toolbar}>
          <Input
            placeholder="Buscar por nome ou slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.search}
          />
        </div>
        {loading ? (
          <div className={styles.skeletonWrap}>
            <Skeleton height={40} width="100%" />
            <Skeleton height={32} width="100%" />
            <Skeleton height={32} width="100%" />
            <Skeleton height={32} width="100%" />
          </div>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <th>Empresa</th>
                <th>Slug</th>
                <th>Plano</th>
                <th>Status</th>
                <th>Agentes</th>
                <th>Mensagens</th>
                <th>Ciclo</th>
                <th></th>
              </tr>
            </TableHead>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <td>
                    <Link to={`/tenants/${t.id}`} className={styles.link}>
                      {t.nome_empresa}
                    </Link>
                  </td>
                  <td>{t.slug}</td>
                  <td>{t.plan}</td>
                  <td>
                    <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                  </td>
                  <td>
                    {t.agents_used_current_period ?? 0} / {t.max_agents ?? "-"}
                  </td>
                  <td>
                    {Number(t?.messages_used_current_period ?? 0).toLocaleString("pt-BR")} / {Number(t?.max_messages ?? 0).toLocaleString("pt-BR")}
                  </td>
                  <td>{t.billing_cycle_start?.slice(0, 10) ?? "-"}</td>
                  <td>
                    <Link to={`/tenants/${t.id}`}>
                      <Button variant="ghost">Ver</Button>
                    </Link>
                  </td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && filtered.length === 0 && (
          <div className={styles.empty}>Nenhum tenant encontrado.</div>
        )}
      </Card>
    </div>
  );
}
