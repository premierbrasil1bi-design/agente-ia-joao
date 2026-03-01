import { Card, Input, Button } from "../components/ui";
import styles from "./SettingsPage.module.css";

export default function SettingsPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Configurações</h1>
      <p className={styles.subtitle}>Preferências do painel e integrações</p>
      <Card title="Geral">
        <div className={styles.form}>
          <Input label="Nome da plataforma" defaultValue="OMNIA AI" />
          <Input label="URL da API" defaultValue="https://api.omnia1biai.com.br" />
          <Button>Salvar</Button>
        </div>
      </Card>
      <Card title="Segurança" className={styles.card}>
        <p className={styles.placeholder}>
          Sessão, 2FA e políticas de senha — em breve.
        </p>
      </Card>
    </div>
  );
}
