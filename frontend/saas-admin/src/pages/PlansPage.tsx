import { useEffect, useState } from "react";
import { Card, Table, TableHead, TableBody, TableRow, Button, Modal, Input, Skeleton } from "../components/ui";
import { adminApi, type Plan } from "../api/admin";
import styles from "./PlansPage.module.css";

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", price: 0, description: "" });

  useEffect(() => {
    adminApi.getPlans().then((data) => {
      setPlans(data);
      setLoading(false);
    });
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", slug: "", price: 0, description: "" });
    setModalOpen(true);
  };

  const openEdit = (p: Plan) => {
    setEditing(p);
    setForm({
      name: p.name,
      slug: p.slug,
      price: p.price,
      description: p.description ?? "",
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (editing) {
      setPlans((prev) =>
        prev.map((p) => (p.id === editing.id ? { ...p, ...form } : p))
      );
    } else {
      setPlans((prev) => [
        ...prev,
        {
          id: String(prev.length + 1),
          ...form,
          max_agents: 0,
          max_messages: 0,
        },
      ]);
    }
    setModalOpen(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Planos</h1>
          <p className={styles.subtitle}>Planos e preços do SaaS</p>
        </div>
        <Button onClick={openCreate}>Criar plano</Button>
      </div>

      <Card>
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
                <th>Nome</th>
                <th>Slug</th>
                <th>Preço</th>
                <th>Descrição</th>
                <th></th>
              </tr>
            </TableHead>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.slug}</td>
                  <td>R$ {(p.price ?? 0).toLocaleString("pt-BR")}</td>
                  <td>{p.description ?? "-"}</td>
                  <td>
                    <Button variant="ghost" onClick={() => openEdit(p)}>
                      Editar
                    </Button>
                  </td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar plano" : "Criar plano"}
      >
        <div className={styles.form}>
          <Input
            label="Nome"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Slug"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          />
          <Input
            label="Preço (R$)"
            type="number"
            value={form.price || ""}
            onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) || 0 }))}
          />
          <Input
            label="Descrição"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div className={styles.formActions}>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave}>Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
