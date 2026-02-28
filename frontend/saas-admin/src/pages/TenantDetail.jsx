import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { request } from "../api/http";

export default function TenantDetail() {
  const { id } = useParams();
  const [tenant, setTenant] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchTenant() {
      const res = await request(`/api/platform/tenants/${id}`);
      if (res && res.ok) setTenant(await res.json());
      else setTenant(null);
    }
    fetchTenant();
  }, [id]);

  async function handleChange(e) {
    setTenant(t => ({ ...t, [e.target.name]: e.target.value }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await request(`/api/platform/tenants/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          plan: tenant.plan,
          status: tenant.status,
          max_agents: tenant.max_agents,
          max_messages: tenant.max_messages,
        }),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function handleResetCycle() {
    await request(`/api/platform/tenants/${id}/reset-cycle`, { method: "POST" });
    navigate(0);
  }

  if (!tenant) return <div>Carregando...</div>;

  return (
    <div>
      <h2>Tenant: {tenant.nome_empresa}</h2>
      <div>
        <label>Status: </label>
        <select name="status" value={tenant.status} onChange={handleChange}>
          <option value="ativo">Ativo</option>
          <option value="inativo">Inativo</option>
        </select>
      </div>
      <div>
        <label>Plano: </label>
        <select name="plan" value={tenant.plan} onChange={handleChange}>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
      </div>
      <div>
        <label>Max Agents: </label>
        <input name="max_agents" type="number" value={tenant.max_agents} onChange={handleChange} />
      </div>
      <div>
        <label>Max Messages: </label>
        <input name="max_messages" type="number" value={tenant.max_messages} onChange={handleChange} />
      </div>
      <button onClick={handleSave} disabled={saving}>Salvar</button>
      <button onClick={handleResetCycle}>Resetar Ciclo</button>
      <Link to={`/tenants/${id}/users`}>Admins do Tenant</Link>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
