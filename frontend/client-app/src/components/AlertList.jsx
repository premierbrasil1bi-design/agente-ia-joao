import styles from './AlertList.module.css';

function formatTime(ts) {
  if (!ts) return 'Agora';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'Agora';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AlertList({ alerts = [] }) {
  if (!alerts.length) {
    return <div className={styles.empty}>Nenhum alerta recente.</div>;
  }

  return (
    <ul className={styles.list}>
      {alerts.map((alert, index) => (
        <li key={`${alert.timestamp || index}-${alert.message || ''}`} className={styles.item}>
          <div className={styles.meta}>
            {(alert.type || 'info').toUpperCase()} · {formatTime(alert.timestamp)}
          </div>
          <p className={styles.message}>{alert.message || 'Sem descricao'}</p>
        </li>
      ))}
    </ul>
  );
}
