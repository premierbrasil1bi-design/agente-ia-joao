import { useEffect, useState } from "react";
import { request } from "../api/http";
import { Card, Table, TableHead, TableBody, TableRow, Button, Input, Select, Modal, Skeleton } from "../components/ui";
import styles from "./TenantsListPage.module.css";

export default function TenantUsersList() {
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [form, setForm] = useState({ tenant_id: "", email: "", password: "" });
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadUsers() {
    try {
      const data = await request("/api/global-admin/tenant-users");
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setUsers([]);
    }
  }

  async function loadTenants() {
    try {
      const data = await request("/api/global-admin/tenants");
      setTenants(Array.isArray(data) ? data : []);
    } catch {
      setTenants([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      await Promise.all([loadUsers(), loadTenants()]);
      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    const { tenant_id, email, password } = form;
    if (!tenant_id || !email?.trim() || !password) {
      setSubmitError("Tenant, email e senha são obrigatórios.");
      return;
    }
    setSubmitting(true);
    try {
      await request("/api/tenant-users", {
        method: "POST",
        body: { tenant_id, email: email.trim(), password },
      });
      setToast("Usuário criado com sucesso");
      setModalOpen(false);
      setForm({ tenant_id: "", email: "", password: "" });
      await loadUsers();
    } catch (err) {
      setSubmitError(err.message ?? "Erro ao criar usuário.");
    } finally {
      setSubmitting(false);
    }
  }

  const tenantOptions = tenants.map((t) => ({
    value: t.id,
    label: t.nome_empresa || t.name || t.slug || t.id,
  }));

  const formatDate = (d) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return String(d);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Usuários de Clientes</h1>
          <p className={styles.subtitle}>Usuários dos tenants (painel do cliente)</p>
        </div>
        <Button onClick={() => { setModalOpen(true); setSubmitError(""); setForm({ tenant_id: "", email: "", password: "" }); }}>
          Novo usuário
        </Button>
      </div>

      {toast && (
        <div role="alert" style={{
          position: "fixed", top: 16, right: 16, padding: "12px 20px", background: "#22c55e", color: "#fff",
          borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 9999,
        }}>
          {toast}
        </div>
      )}

      <Card>
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
                <th>Email</th>
                <th>Tenant</th>
                <th>Criado em</th>
                <th>Ações</th>
              </tr>
            </TableHead>
            <TableBody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    Nenhum usuário de cliente cadastrado.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.tenant_name ?? u.tenant_id}</td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>—</td>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Novo usuário">
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <Select
              label="Tenant"
              options={tenantOptions}
              placeholder="Selecione o tenant"
              value={form.tenant_id}
              onChange={(e) => setForm((f) => ({ ...f, tenant_id: e.target.value }))}
              required
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Input
              label="Email"
              type="email"
              placeholder="email@exemplo.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Input
              label="Senha"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
            />
          </div>
          {submitError && <p style={{ color: "var(--danger, #dc2626)", marginTop: 8 }}>{submitError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button type="submit" disabled={submitting}>{submitting ? "Criando…" : "Criar"}</Button>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
