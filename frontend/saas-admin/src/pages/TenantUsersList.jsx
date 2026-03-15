import { useEffect, useState } from "react";
import { request } from "../api/http";
import { Card, Table, TableHead, TableBody, TableRow, Button, Input, Select, Modal, Skeleton, Badge } from "../components/ui";
import styles from "./TenantsListPage.module.css";

const toastStyle = {
  position: "fixed",
  top: 16,
  right: 16,
  padding: "12px 20px",
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
  zIndex: 9999,
  color: "#fff",
};
const toastSuccess = { ...toastStyle, background: "#22c55e" };
const toastError = { ...toastStyle, background: "#dc2626" };

export default function TenantUsersList() {
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ text: "", error: false });

  // Novo usuário
  const [modalCreateOpen, setModalCreateOpen] = useState(false);
  const [formCreate, setFormCreate] = useState({ tenant_id: "", email: "", password: "" });
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Editar
  const [editUser, setEditUser] = useState(null);
  const [formEdit, setFormEdit] = useState({ email: "", name: "" });
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Toggle ativo
  const [toggleUser, setToggleUser] = useState(null);
  const [toggleSubmitting, setToggleSubmitting] = useState(false);

  // Resetar senha
  const [resetUser, setResetUser] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);

  // Excluir
  const [deleteUser, setDeleteUser] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

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
    if (!toast.text) return;
    const t = setTimeout(() => setToast({ text: "", error: false }), 4000);
    return () => clearTimeout(t);
  }, [toast.text]);

  function showToast(text, isError = false) {
    setToast({ text, error: isError });
  }

  async function handleCreateSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    const { tenant_id, email, password } = formCreate;
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
      showToast("Usuário criado com sucesso");
      setModalCreateOpen(false);
      setFormCreate({ tenant_id: "", email: "", password: "" });
      await loadUsers();
    } catch (err) {
      setSubmitError(err.message ?? "Erro ao criar usuário.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editUser) return;
    setEditSubmitting(true);
    try {
      await request(`/api/tenant-users/${editUser.id}`, {
        method: "PATCH",
        body: { email: formEdit.email.trim(), name: formEdit.name.trim() || undefined },
      });
      showToast("Usuário atualizado com sucesso");
      setEditUser(null);
      await loadUsers();
    } catch (err) {
      showToast(err.message ?? "Erro ao atualizar.", true);
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleToggleSubmit() {
    if (!toggleUser) return;
    const newActive = !toggleUser.active;
    setToggleSubmitting(true);
    try {
      await request(`/api/tenant-users/${toggleUser.id}/toggle-active`, {
        method: "PATCH",
        body: { active: newActive },
      });
      showToast(newActive ? "Usuário reativado com sucesso" : "Usuário suspenso com sucesso");
      setToggleUser(null);
      await loadUsers();
    } catch (err) {
      showToast(err.message ?? "Erro ao alterar status.", true);
    } finally {
      setToggleSubmitting(false);
    }
  }

  async function handleResetSubmit(e) {
    e.preventDefault();
    if (!resetUser || !resetPassword.trim()) return;
    if (resetPassword.length < 6) {
      showToast("Senha deve ter no mínimo 6 caracteres.", true);
      return;
    }
    setResetSubmitting(true);
    try {
      await request(`/api/tenant-users/${resetUser.id}/reset-password`, {
        method: "PATCH",
        body: { password: resetPassword },
      });
      showToast("Senha redefinida com sucesso");
      setResetUser(null);
      setResetPassword("");
    } catch (err) {
      showToast(err.message ?? "Erro ao redefinir senha.", true);
    } finally {
      setResetSubmitting(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteUser) return;
    setDeleteSubmitting(true);
    try {
      await request(`/api/tenant-users/${deleteUser.id}`, { method: "DELETE" });
      showToast("Usuário excluído com sucesso");
      setDeleteUser(null);
      await loadUsers();
    } catch (err) {
      showToast(err.message ?? "Erro ao excluir.", true);
    } finally {
      setDeleteSubmitting(false);
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

  const actionBtn = (label, onClick, variant = "ghost") => (
    <Button key={label} type="button" variant={variant} onClick={onClick} style={{ marginRight: 6, marginBottom: 4 }}>
      {label}
    </Button>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Usuários de Clientes</h1>
          <p className={styles.subtitle}>Usuários dos tenants (painel do cliente)</p>
        </div>
        <Button onClick={() => { setModalCreateOpen(true); setSubmitError(""); setFormCreate({ tenant_id: "", email: "", password: "" }); }}>
          Novo usuário
        </Button>
      </div>

      {toast.text && (
        <div role="alert" style={toast.error ? toastError : toastSuccess}>
          {toast.text}
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
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </TableHead>
            <TableBody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    Nenhum usuário de cliente cadastrado.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.tenant_name ?? u.tenant_id}</td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>
                      <Badge variant={u.active !== false ? "success" : "default"}>
                        {u.active !== false ? "Ativo" : "Inativo"}
                      </Badge>
                    </td>
                    <td>
                      {actionBtn("Editar", () => { setEditUser(u); setFormEdit({ email: u.email, name: u.name ?? "" }); })}
                      {actionBtn(u.active !== false ? "Suspender" : "Reativar", () => setToggleUser(u))}
                      {actionBtn("Resetar senha", () => { setResetUser(u); setResetPassword(""); })}
                      {actionBtn("Excluir", () => setDeleteUser(u), "danger")}
                    </td>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Modal: Novo usuário */}
      <Modal open={modalCreateOpen} onClose={() => setModalCreateOpen(false)} title="Novo usuário">
        <form onSubmit={handleCreateSubmit}>
          <div style={{ marginBottom: 16 }}>
            <Select
              label="Tenant"
              options={tenantOptions}
              placeholder="Selecione o tenant"
              value={formCreate.tenant_id}
              onChange={(e) => setFormCreate((f) => ({ ...f, tenant_id: e.target.value }))}
              required
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Input
              label="Email"
              type="email"
              placeholder="email@exemplo.com"
              value={formCreate.email}
              onChange={(e) => setFormCreate((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Input
              label="Senha"
              type="password"
              placeholder="••••••••"
              value={formCreate.password}
              onChange={(e) => setFormCreate((f) => ({ ...f, password: e.target.value }))}
              required
            />
          </div>
          {submitError && <p style={{ color: "var(--danger, #dc2626)", marginTop: 8 }}>{submitError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button type="submit" disabled={submitting}>{submitting ? "Criando…" : "Criar"}</Button>
            <Button type="button" variant="secondary" onClick={() => setModalCreateOpen(false)}>Cancelar</Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Editar */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="Editar usuário">
        {editUser && (
          <form onSubmit={handleEditSubmit}>
            <div style={{ marginBottom: 16 }}>
              <Input
                label="Email"
                type="email"
                value={formEdit.email}
                onChange={(e) => setFormEdit((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Input
                label="Nome"
                value={formEdit.name}
                onChange={(e) => setFormEdit((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button type="submit" disabled={editSubmitting}>{editSubmitting ? "Salvando…" : "Salvar"}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditUser(null)}>Cancelar</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Suspender / Reativar */}
      <Modal open={!!toggleUser} onClose={() => setToggleUser(null)} title={toggleUser?.active !== false ? "Suspender usuário" : "Reativar usuário"}>
        {toggleUser && (
          <>
            <p style={{ margin: "0 0 16px" }}>
              {toggleUser.active !== false
                ? "Tem certeza que deseja suspender este usuário? Ele não poderá fazer login até ser reativado."
                : "Tem certeza que deseja reativar este usuário?"}
            </p>
            <p style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: "0.9rem" }}>{toggleUser.email}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={handleToggleSubmit} disabled={toggleSubmitting}>
                {toggleSubmitting ? "Processando…" : toggleUser.active !== false ? "Suspender" : "Reativar"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setToggleUser(null)}>Cancelar</Button>
            </div>
          </>
        )}
      </Modal>

      {/* Modal: Resetar senha */}
      <Modal open={!!resetUser} onClose={() => { setResetUser(null); setResetPassword(""); }} title="Resetar senha">
        {resetUser && (
          <form onSubmit={handleResetSubmit}>
            <p style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: "0.9rem" }}>{resetUser.email}</p>
            <div style={{ marginBottom: 16 }}>
              <Input
                label="Nova senha"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button type="submit" disabled={resetSubmitting || resetPassword.length < 6}>
                {resetSubmitting ? "Salvando…" : "Redefinir senha"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setResetUser(null); setResetPassword(""); }}>Cancelar</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Excluir */}
      <Modal open={!!deleteUser} onClose={() => setDeleteUser(null)} title="Excluir usuário">
        {deleteUser && (
          <>
            <p style={{ margin: "0 0 16px" }}>Tem certeza que deseja excluir este usuário?</p>
            <p style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: "0.9rem" }}>{deleteUser.email}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="danger" onClick={handleDeleteConfirm} disabled={deleteSubmitting}>
                {deleteSubmitting ? "Excluindo…" : "Excluir"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDeleteUser(null)}>Cancelar</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
