import styles from './AlertBanner.module.css';

const TYPE_LABEL = {
  critical: 'Alerta critico',
  warning: 'Atencao',
  info: 'Informacao',
};

export default function AlertBanner({ alert }) {
  if (!alert || !alert.message) return null;
  const type = (alert.type || 'info').toLowerCase();
  const className = `${styles.banner} ${styles[type] || styles.info}`;

  return (
    <div className={className} role="alert" aria-live="polite">
      <p className={styles.title}>{TYPE_LABEL[type] || TYPE_LABEL.info}</p>
      <p className={styles.message}>{alert.message}</p>
    </div>
  );
}
