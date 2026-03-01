import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../api/http";

export default function TenantNew() {
  const [form, setForm] = useState({
    nome_empresa: "",
    slug: "",
    plan: "free",
    max_agents: 1,
    max_messages: 1000,
    status: "ativo",
  });
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.nome_empresa || !form.slug) {
      setError("Preencha todos os campos obrigatórios");
      return;
    }
    try {
      await request("/api/platform/tenants", {
        method: "POST",
        body: form,
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
        <button type="submit">Criar</button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
