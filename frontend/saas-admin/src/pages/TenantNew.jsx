import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../api/admin";

const PROVIDER_OPTIONS = [
  { value: "evolution", label: "Evolution" },
  { value: "waha", label: "WAHA" },
  { value: "zapi", label: "Z-API" },
];

function sanitizeAllowedProviders(list) {
  const valid = new Set(PROVIDER_OPTIONS.map((p) => p.value));
  return [...new Set((Array.isArray(list) ? list : []).map((p) => String(p || "").toLowerCase().trim()))].filter(
    (p) => valid.has(p)
  );
}

export default function TenantNew() {
  const [form, setForm] = useState({
    nome_empresa: "",
    slug: "",
    plan: "free",
    max_agents: 1,
    max_messages: 1000,
    status: "ativo",
    allowed_providers: [],
  });
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function toggleProvider(provider) {
    setForm((prev) => {
      const current = new Set(prev.allowed_providers || []);
      if (current.has(provider)) current.delete(provider);
      else current.add(provider);
      return { ...prev, allowed_providers: [...current] };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.nome_empresa || !form.slug) {
      setError("Preencha todos os campos obrigatórios");
      return;
    }
    try {
      await adminApi.createTenant({
        ...form,
        allowed_providers: sanitizeAllowedProviders(form.allowed_providers),
      });
      navigate("/tenants");
    } catch (err) {
      setError(err.message ?? "Erro ao criar tenant");
    }
  }

  return (
    <div>
      <h2>Novo Tenant</h2>
      <form onSubmit={handleSubmit}>
        <input name="nome_empresa" placeholder="Empresa*" value={form.nome_empresa} onChange={handleChange} required />
        <input name="slug" placeholder="Slug*" value={form.slug} onChange={handleChange} required />
        <select name="plan" value={form.plan} onChange={handleChange}>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
        <input name="max_agents" type="number" min="1" value={form.max_agents} onChange={handleChange} />
        <input name="max_messages" type="number" min="1" value={form.max_messages} onChange={handleChange} />
        <select name="status" value={form.status} onChange={handleChange}>
          <option value="ativo">Ativo</option>
          <option value="inativo">Inativo</option>
        </select>
        <div style={{ marginTop: 12 }}>
          <strong>Providers de WhatsApp liberados</strong>
          <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            {PROVIDER_OPTIONS.map((provider) => (
              <label key={provider.value} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={(form.allowed_providers || []).includes(provider.value)}
                  onChange={() => toggleProvider(provider.value)}
                />
                <span>{provider.label}</span>
              </label>
            ))}
          </div>
          <small style={{ display: "block", color: "var(--text-muted)", marginTop: 6 }}>
            Esses providers ficarão disponíveis para os usuários deste tenant conforme o pacote contratado.
          </small>
        </div>
        <button type="submit">Criar</button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
