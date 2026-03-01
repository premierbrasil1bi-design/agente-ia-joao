import { Card } from "../components/ui";
import styles from "./AdminsPage.module.css";

export default function AdminsPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Admins</h1>
      <p className={styles.subtitle}>Administradores globais do painel</p>
      <Card title="Em breve">
        <p className={styles.placeholder}>
          CRUD de admins globais (convite, roles, revogar).
        </p>
      </Card>
    </div>
  );
}
