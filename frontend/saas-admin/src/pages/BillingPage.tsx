import { Card } from "../components/ui";
import styles from "./BillingPage.module.css";

export default function BillingPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Billing</h1>
      <p className={styles.subtitle}>Faturamento e cobrança da plataforma</p>
      <Card title="Em breve">
        <p className={styles.placeholder}>
          Integração com gateway de pagamento e faturas por tenant.
        </p>
      </Card>
    </div>
  );
}
