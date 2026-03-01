import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { request } from "../api/http";

export default function TenantUsers() {
  const { id } = useParams();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchUsers() {
      try {
        const data = await request(`/api/platform/tenants/${id}/users`);
        setUsers(Array.isArray(data) ? data : []);
      } catch {
        setUsers([]);
      }
    }
    if (id) fetchUsers();
  }, [id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await request(`/api/platform/tenants/${id}/users`, {
        method: "POST",
        body: { ...form, role: "admin" },
      });
      setForm({ name: "", email: "", password: "" });
    } catch (err) {
      setError(err.message ?? "Erro ao criar admin");
    }
  }

  return (
    <div>
      <h2>Admins do Tenant</h2>
      <form onSubmit={handleSubmit}>
        <input name="name" placeholder="Nome" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        <input name="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
        <input name="password" type="password" placeholder="Senha" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
        <button type="submit">Criar Admin</button>
        {error && <div className="error">{error}</div>}
      </form>
      <ul>
        {users.map(u => (
          <li key={u.id}>{u.name} ({u.email})</li>
        ))}
      </ul>
    </div>
  );
}
