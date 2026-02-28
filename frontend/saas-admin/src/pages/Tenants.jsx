import { useEffect, useState } from "react";
import { globalAdminApi } from "../services/globalAdminApi";
import { Link } from "react-router-dom";

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    globalAdminApi.getTenants()
      .then((data) => setTenants(Array.isArray(data) ? data : []))
      .catch(() => setTenants([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2>Tenants</h2>
      <Link to="/tenants/new">Novo Tenant</Link>
      {loading ? (
        <div>Carregando...</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Slug</th>
              <th>Plano</th>
              <th>Status</th>
              <th>Max Agents</th>
              <th>Max Msgs</th>
              <th>Agents Usados</th>
              <th>Msgs Usadas</th>
              <th>Início Ciclo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map(t => (
              <tr key={t.id}>
                <td>{t.nome_empresa}</td>
                <td>{t.slug}</td>
                <td>{t.plan}</td>
                <td>{t.status}</td>
                <td>{t.max_agents}</td>
                <td>{t.max_messages}</td>
                <td>{t.agents_used_current_period}</td>
                <td>{t.messages_used_current_period}</td>
                <td>{t.billing_cycle_start?.slice(0,10)}</td>
                <td>
                  <Link to={`/tenants/${t.id}`}>Detalhes</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
