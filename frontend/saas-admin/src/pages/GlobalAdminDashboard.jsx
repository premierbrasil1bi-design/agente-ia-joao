import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { globalAdminApi } from "../services/globalAdminApi";
import "./GlobalAdminDashboard.css";

export default function GlobalAdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ totalTenants: 0, totalAgents: 0, usageGlobal: 0, billingTotal: 0 });
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [s, t] = await Promise.all([
          globalAdminApi.getStats(),
          globalAdminApi.getTenants(),
        ]);
        if (!cancelled) {
          setStats(s);
          setTenants(Array.isArray(t) ? t : []);
        }
      } catch {
        if (!cancelled) setTenants([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="ga-dashboard" role="main" aria-label="Dashboard do administrador global">
      <aside className="ga-dashboard__sidebar" aria-label="Navegação principal">
        <h2 className="ga-dashboard__sidebar-title">Global Admin</h2>
        <nav className="ga-dashboard__nav">
          <Link to="/dashboard" className="ga-dashboard__nav-link ga-dashboard__nav-link--active">Dashboard</Link>
          <Link to="/tenants" className="ga-dashboard__nav-link">Tenants</Link>
          <Link to="/plans" className="ga-dashboard__nav-link">Plans</Link>
        </nav>
      </aside>
      <div className="ga-dashboard__main-wrap">
      <header className="ga-dashboard__header">
        <h2 className="ga-dashboard__header-title">Dashboard</h2>
        <div className="ga-dashboard__header-user">
          <span className="ga-dashboard__header-name" aria-label={`Usuário: ${user?.name || user?.email}`}>
            {user?.name || user?.email}
          </span>
          <button
            type="button"
            className="ga-dashboard__logout"
            onClick={() => { globalAdminApi.logout(); window.location.href = "/login"; }}
            aria-label="Sair da conta"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="ga-dashboard__cards">
        <div className="ga-dashboard__card" aria-label="Total de tenants">
          <span className="ga-dashboard__card-label">Total Tenants</span>
          <span className="ga-dashboard__card-value">{stats.totalTenants}</span>
        </div>
        <div className="ga-dashboard__card" aria-label="Total de agentes">
          <span className="ga-dashboard__card-label">Total Agents</span>
          <span className="ga-dashboard__card-value">{stats.totalAgents}</span>
        </div>
        <div className="ga-dashboard__card" aria-label="Uso global">
          <span className="ga-dashboard__card-label">Usage Global</span>
          <span className="ga-dashboard__card-value">{stats.usageGlobal}</span>
        </div>
        <div className="ga-dashboard__card" aria-label="Billing total">
          <span className="ga-dashboard__card-label">Billing Total</span>
          <span className="ga-dashboard__card-value">R$ {Number(stats.billingTotal).toFixed(2)}</span>
        </div>
      </div>

      <section className="ga-dashboard__section" aria-label="Lista de tenants">
        <h3 className="ga-dashboard__section-title">Tenants</h3>
        {loading ? (
          <p className="ga-dashboard__loading">Carregando…</p>
        ) : (
          <div className="ga-dashboard__table-wrap">
            <table className="ga-dashboard__table">
              <thead>
                <tr>
                  <th scope="col">Empresa</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Plano</th>
                  <th scope="col">Status</th>
                  <th scope="col">Max Agents</th>
                  <th scope="col">Max Msgs</th>
                </tr>
              </thead>
              <tbody>
                {tenants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="ga-dashboard__empty">Nenhum tenant cadastrado.</td>
                  </tr>
                ) : (
                  tenants.map((t) => (
                    <tr key={t.id}>
                      <td>{t.nome_empresa}</td>
                      <td><code>{t.slug}</code></td>
                      <td>{t.plan}</td>
                      <td>{t.status}</td>
                      <td>{t.max_agents}</td>
                      <td>{t.max_messages}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
