import React from 'react';
import { CHANNEL_CONNECTION_STATE } from '../constants/channelConnectionStates.js';

const STATE_META = {
  [CHANNEL_CONNECTION_STATE.GENERATING_QR]: {
    icon: '🔵',
    text: 'Gerando QR Code...',
    color: '#2563eb',
    bg: 'rgba(37,99,235,0.12)',
    border: 'rgba(37,99,235,0.35)',
  },
  [CHANNEL_CONNECTION_STATE.WAITING_SCAN]: {
    icon: '🟡',
    text: 'Aguardando leitura...',
    color: '#b8860b',
    bg: 'rgba(184,134,11,0.16)',
    border: 'rgba(184,134,11,0.35)',
  },
  [CHANNEL_CONNECTION_STATE.CONNECTED]: {
    icon: '🟢',
    text: 'Conectado com sucesso',
    color: '#1f9d55',
    bg: 'rgba(31,157,85,0.13)',
    border: 'rgba(31,157,85,0.35)',
  },
  [CHANNEL_CONNECTION_STATE.TIMEOUT]: {
    icon: '🔴',
    text: 'Tempo expirado. Tente novamente',
    color: '#c0392b',
    bg: 'rgba(192,57,43,0.12)',
    border: 'rgba(192,57,43,0.35)',
  },
  [CHANNEL_CONNECTION_STATE.ERROR]: {
    icon: '🔴',
    text: 'Erro ao conectar',
    color: '#c0392b',
    bg: 'rgba(192,57,43,0.12)',
    border: 'rgba(192,57,43,0.35)',
  },
};

export function ConnectionStateBanner({ state, error = null }) {
  const meta = STATE_META[state];
  if (!meta) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginTop: '0.5rem',
        padding: '0.55rem 0.7rem',
        borderRadius: 8,
        border: `1px solid ${meta.border}`,
        background: meta.bg,
        color: meta.color,
        fontSize: '0.85rem',
        fontWeight: 500,
      }}
    >
      <span>{meta.icon}</span>
      <span>{error && state === CHANNEL_CONNECTION_STATE.ERROR ? `Erro ao conectar: ${error}` : meta.text}</span>
    </div>
  );
}

export default ConnectionStateBanner;

