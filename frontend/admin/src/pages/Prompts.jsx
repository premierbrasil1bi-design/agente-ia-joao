/**
 * Página "Prompts" – editor de prompt por canal.
 * Regra: se existir prompt do canal, ele substitui o prompt base.
 * UI pronta; backend PUT pode ser mockado (TODO).
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChannel } from '../context/ChannelContext';
import { useAgentAuth } from '../context/AgentAuthContext';
import { createApiClient } from '../api/client';

const CANAIS = [
  { id: 'base', type: null, label: 'Prompt base', desc: 'Usado quando não há prompt específico do canal.' },
  { id: 'web', type: 'web', label: 'Prompt canal WEB', desc: 'Prompt específico do canal WEB.' },
  { id: 'api', type: 'api', label: 'Prompt canal API', desc: 'Prompt específico do canal API.' },
  { id: 'whatsapp', type: 'whatsapp', label: 'Prompt canal WHATSAPP', desc: 'Prompt específico do canal WHATSAPP.' },
  { id: 'instagram', type: 'instagram', label: 'Prompt canal INSTAGRAM', desc: 'Prompt específico do canal INSTAGRAM.' },
];

const styles = {
  rule: {
    padding: '1rem 1.25rem',
    background: 'rgba(88, 166, 255, 0.1)',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    marginBottom: '1.5rem',
    fontSize: '0.9rem',
    color: 'var(--text)',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '1.25rem',
    marginBottom: '1.5rem',
  },
  label: {
    fontSize: '0.85rem',
    fontWeight: 600,
    marginBottom: 6,
    color: 'var(--text)',
  },
  desc: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    marginBottom: '0.75rem',
  },
  textarea: {
    width: '100%',
    minHeight: 140,
    padding: '0.75rem',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text)',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    resize: 'vertical',
    marginBottom: '0.75rem',
  },
  btn: {
    padding: '0.5rem 1rem',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  badge: {
    display: 'inline-block',
    padding: '0.2rem 0.5rem',
    borderRadius: 4,
    fontSize: '0.7rem',
    fontWeight: 600,
    marginLeft: '0.5rem',
  },
  badgeBase: { background: 'rgba(63, 185, 80, 0.2)', color: 'var(--success)' },
  badgeCanal: { background: 'rgba(88, 166, 255, 0.2)', color: 'var(--accent)' },
};

export function Prompts() {
  const { channel } = useChannel();
  const { getToken, logout } = useAgentAuth();
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState({});
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);

  const onUnauthorized = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  useEffect(() => {
    let cancelled = false;
    const api = createApiClient(() => channel, getToken, onUnauthorized);
    api
      .getPrompts('1')
      .then((data) => {
        if (!cancelled) {
          const list = Array.isArray(data) ? data : [];
          const map = {};
          list.forEach((p) => {
            const key = p.channel_id == null ? 'base' : p.channel_id;
            map[key] = p.content || '';
          });
          CANAIS.forEach((c) => {
            if (map[c.id] === undefined) map[c.id] = c.id === 'base' ? 'Você é um assistente prestativo.' : '';
          });
          setPrompts(map);
          setEdits(map);
        }
      })
      .catch(() => {
        if (!cancelled) {
          const mock = {};
          CANAIS.forEach((c) => {
            mock[c.id] = c.id === 'base' ? 'Você é um assistente prestativo. Resposta em português.' : '';
          });
          setPrompts(mock);
          setEdits(mock);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [channel, getToken, onUnauthorized]);

  const handleChange = (id, value) => {
    setEdits((prev) => ({ ...prev, [id]: value }));
  };

  const handleSave = (id) => {
    setSaveStatus(`Salvando prompt "${id}"...`);
    setTimeout(() => {
      setSaveStatus(`Prompt "${id}" salvo (mock). Backend PUT em evolução.`);
      setPrompts((prev) => ({ ...prev, [id]: edits[id] }));
      setTimeout(() => setSaveStatus(null), 3000);
    }, 500);
  };

  if (loading) {
    return <p style={{ color: 'var(--text-muted)' }}>Carregando prompts...</p>;
  }

  return (
    <>
      <div style={styles.rule}>
        <strong>Regra:</strong> Se existir prompt do canal, ele substitui o prompt base. Caso contrário, o agente usa o prompt base (channel_id = NULL).
      </div>

      {saveStatus && (
        <p style={{ color: 'var(--accent)', marginBottom: '1rem', fontSize: '0.9rem' }}>{saveStatus}</p>
      )}

      {CANAIS.map((c) => (
        <div key={c.id} style={styles.card}>
          <div style={styles.label}>
            {c.label}
            <span style={{ ...styles.badge, ...(c.id === 'base' ? styles.badgeBase : styles.badgeCanal) }}>
              {c.id === 'base' ? 'Prompt base' : 'Prompt específico do canal'}
            </span>
          </div>
          <div style={styles.desc}>{c.desc}</div>
          <textarea
            style={styles.textarea}
            value={edits[c.id] ?? ''}
            onChange={(e) => handleChange(c.id, e.target.value)}
            placeholder="Digite o texto do prompt..."
          />
          <button style={styles.btn} type="button" onClick={() => handleSave(c.id)}>
            Salvar prompt
          </button>
        </div>
      ))}
    </>
  );
}
