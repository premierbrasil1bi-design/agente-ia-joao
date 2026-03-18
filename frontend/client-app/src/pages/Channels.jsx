import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { socket } from '../lib/socket.js';
import { agentApi } from '../services/agentApi.js';
import StatusBadge from '../components/StatusBadge.jsx';
import useAutoReconnect from '../hooks/useAutoReconnect.js';

  async function loadChannels() {
    const data = await agentApi.request('/api/agent/channels');
    setChannels(Array.isArray(data) ? data : []);
  }

  async function loadAgents() {
    const data = await agentApi.request('/api/agent/agents');
    setAgents(Array.isArray(data) ? data : []);
  }

  async function createChannel() {
    if (!name || !agentId) {
      toast.error('Preencha todos os campos');
      return;
    }

    setLoadingCreate(true);
    try {
      const data = await agentApi.request('/api/channels', {
        method: 'POST',
        body: { name, agentId },
      });

      toast.success('Canal criado com sucesso');

      setShowModal(false);
      setName('');
      setAgentId('');

      await loadChannels();

      if (data?.channel?.id) {
        startPolling(data.channel.id);
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Erro ao criar canal');
    } finally {
      setLoadingCreate(false);
    }
  }

  function restoreQr(channelId) {
    const saved = sessionStorage.getItem(`qr_${channelId}`);
    if (saved) {
      setQrCode(saved);
    }
  }

  async function getQr(channelId) {
    setLoadingQr(channelId);
    try {
      const data = await agentApi.request(`/api/channels/${channelId}/qrcode`, { method: 'GET' });

      if (!data?.qrcode) {
        throw new Error('QR não disponível');
      }

      const raw = typeof data.qrcode === 'string' ? data.qrcode : data.qrcode?.base64 ?? data.qrcode?.code ?? '';
      const qr = raw.startsWith('data:image') ? raw : `data:image/png;base64,${raw}`;

      sessionStorage.setItem(`qr_${channelId}`, qr);
      setQrCode(qr);

      startPolling(channelId);
    } catch (err) {
      console.error(err);
      toast.error('Erro na conexão com WhatsApp');
    } finally {
      setLoadingQr(null);
    }
  }

  const startPolling = useCallback((channelId) => {
    if (pollingRefs.current[channelId]) return;

    pollingRefs.current[channelId] = setInterval(async () => {
      try {
        const data = await agentApi.request(`/api/channels/${channelId}/status`, { method: 'GET' });

        setChannels((prev) =>
          prev.map((ch) => (ch.id === channelId ? { ...ch, status: data.status } : ch)),
        );

        if (['connected', 'disconnected'].includes(data.status)) {
          clearInterval(pollingRefs.current[channelId]);
          delete pollingRefs.current[channelId];
        }
      } catch {
        // silencioso
      }
    }, 5000);
  }, []);

  useAutoReconnect(channels, startPolling);

  useEffect(() => {
    loadChannels();
    loadAgents();

    socket.on('channel_status_update', ({ channelId, status }) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.id === channelId ? { ...ch, status } : ch)),
      );
    });

    return () => {
      socket.off('channel_status_update');
      Object.values(pollingRefs.current).forEach(clearInterval);
    };
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h1>Canais</h1>

      <button type="button" onClick={() => setShowModal(true)}>
        ➕ Novo Canal
      </button>

      <table style={{ marginTop: 20, width: '100%' }}>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
            {channels.map((ch) => (
              <tr key={ch.id}>
                <td>{ch.instance || ch.name}</td>
                <td>
                  <StatusBadge status={ch.status} />
                </td>
                <td>
                  {ch.status === 'created' && (
                    <button
                      type="button"
                      disabled={loadingQr === ch.id || loadingCreate}
                      onClick={() => {
                        restoreQr(ch.id);
                        getQr(ch.id);
                      }}
                    >
                      {loadingQr === ch.id ? 'Gerando...' : 'Conectar WhatsApp'}
                    </button>
                  )}
                  {ch.status === 'connecting' && (
                    <span>Escaneie o QR Code no seu WhatsApp</span>
                  )}
                  {ch.status === 'connected' && <span>✅ Conectado</span>}
                  {!ch.status && (
                    <button
                      type="button"
                      disabled={loadingQr === ch.id || loadingCreate}
                      onClick={() => {
                        restoreQr(ch.id);
                        getQr(ch.id);
                      }}
                    >
                      {loadingQr === ch.id ? 'Gerando...' : 'QR Code'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {showModal && (
        <div className="modal">
          <h2>Novo Canal</h2>

          <input
            placeholder="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Selecione</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <button type="button" disabled={loadingCreate} onClick={createChannel}>
            {loadingCreate ? 'Criando...' : 'Criar Canal'}
          </button>

          <button type="button" onClick={() => setShowModal(false)}>
            Cancelar
          </button>
        </div>
      )}

      {qrCode && (
        <div className="modal">
          <h2>QR Code</h2>
          <img src={qrCode} alt="QR Code" />
          <button type="button" onClick={() => setQrCode(null)}>
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
