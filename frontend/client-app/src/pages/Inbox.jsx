import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { channelsService } from '../services/channels.service.js';
import { messagesService } from '../services/messages.service.js';
import { agentApi } from '../services/agentApi.js';
import { normalizeChannelType } from '../utils/channelCore.js';
import { getChannelCapabilities } from '../utils/channelCapabilities.js';

const PAGE_SIZE = 40;

const CHANNEL_ICON = {
  whatsapp: '💬',
  webchat: '🌐',
  telegram: '📨',
  instagram: '📸',
  unknown: '🔘',
};

const styles = {
  wrap: { display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, height: 'calc(100vh - 180px)' },
  panel: { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  header: { padding: '0.75rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  list: { overflowY: 'auto', flex: 1 },
  item: { padding: '0.7rem', borderBottom: '1px solid var(--border)', cursor: 'pointer' },
  messages: { padding: '0.8rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 },
  bubbleIn: { alignSelf: 'flex-start', maxWidth: '70%', padding: '0.55rem 0.7rem', borderRadius: 10, background: 'rgba(255,255,255,0.08)' },
  bubbleOut: { alignSelf: 'flex-end', maxWidth: '70%', padding: '0.55rem 0.7rem', borderRadius: 10, background: 'rgba(37,99,235,0.22)' },
  composer: { display: 'flex', gap: 8, padding: '0.75rem', borderTop: '1px solid var(--border)' },
  input: { flex: 1, padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' },
  button: { padding: '0.55rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' },
  typing: { fontSize: 12, color: 'var(--text-muted)', marginTop: 2 },
  chanBadge: { fontSize: 12, border: '1px solid var(--border)', borderRadius: 999, padding: '0.1rem 0.45rem', opacity: 0.85 },
};

function mapConversation(raw) {
  const channelType = normalizeChannelType(raw?.channelType || raw?.channel_type);
  const participantId = String(raw?.participantId || raw?.contact || '');
  return {
    id: raw?.id || `${raw?.channelId || raw?.channel_id}:${participantId}`,
    tenantId: raw?.tenantId || raw?.tenant_id || null,
    channelId: raw?.channelId || raw?.channel_id || null,
    channelType,
    participantId,
    participantName: raw?.participantName || participantId,
    participantAvatar: raw?.participantAvatar || null,
    participantHandle: raw?.participantHandle || null,
    lastMessage: raw?.lastMessage || raw?.last_message || '',
    lastMessageAt: raw?.lastMessageAt || raw?.timestamp || null,
    unreadCount: Number(raw?.unreadCount || 0),
    status: raw?.status || 'SENT',
  };
}

function mapMessage(raw) {
  const channelType = normalizeChannelType(raw?.channelType || raw?.channel_type);
  const participantId = String(raw?.participantId || raw?.contact || '');
  return {
    id: raw?.id,
    tenantId: raw?.tenantId || raw?.tenant_id || null,
    channelId: raw?.channelId || raw?.channel_id || null,
    channelType,
    conversationId: raw?.conversationId || `${raw?.channelId || raw?.channel_id}:${participantId}`,
    senderType: raw?.senderType || (raw?.direction === 'inbound' ? 'customer' : 'agent'),
    participantId,
    participantName: raw?.participantName || participantId,
    content: raw?.content || raw?.message || '',
    contentType: raw?.contentType || 'text',
    timestamp: raw?.timestamp,
    status: String(raw?.status || 'SENT').toUpperCase(),
  };
}

const MessageBubble = memo(function MessageBubble({ message, supportsReadReceipts, supportsDelivery }) {
  const isOutbound = message.senderType === 'agent';
  const statusMark =
    message.status === 'READ'
      ? '✔✔'
      : message.status === 'DELIVERED'
        ? '✔✔'
        : message.status === 'FAILED'
          ? '!'
          : '✔';
  const statusColor =
    message.status === 'READ'
      ? '#3b82f6'
      : message.status === 'FAILED'
        ? '#ef4444'
        : 'var(--text-muted)';
  const canShowStatus = isOutbound && (supportsDelivery || supportsReadReceipts);
  return (
    <div style={isOutbound ? styles.bubbleOut : styles.bubbleIn}>
      <div>{message.content}</div>
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 3, display: 'flex', gap: 6, justifyContent: isOutbound ? 'flex-end' : 'flex-start' }}>
        <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
        {canShowStatus ? <span style={{ color: statusColor }}>{statusMark}</span> : null}
      </div>
    </div>
  );
});

export function Inbox() {
  const [channels, setChannels] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [typing, setTyping] = useState(false);
  const [hasUnreadNew, setHasUnreadNew] = useState(false);
  const endRef = useRef(null);
  const messagesRef = useRef(null);
  const socketRef = useRef(null);
  const activeChannelRef = useRef('');
  const activeConversationRef = useRef('');
  const tenantIdRef = useRef('');
  const isAtBottomRef = useRef(true);
  const typingDebounceRef = useRef(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => String(c.id) === String(activeConversationId)) || null,
    [conversations, activeConversationId]
  );
  const activeChannelType = useMemo(() => {
    const row = channels.find((c) => String(c.id) === String(activeChannelId));
    return normalizeChannelType(row?.type);
  }, [channels, activeChannelId]);
  const capabilities = useMemo(() => getChannelCapabilities(activeChannelType), [activeChannelType]);

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const ch = await channelsService.listAgentChannels();
      setChannels(Array.isArray(ch) ? ch : []);
      const first = (Array.isArray(ch) ? ch : [])[0]?.id || '';
      if (first && !activeChannelId) setActiveChannelId(first);
    } finally {
      setLoading(false);
    }
  }, [activeChannelId]);

  const loadConversations = useCallback(async () => {
    if (!activeChannelId) return;
    const rows = await messagesService.listConversations(activeChannelId);
    const mapped = (Array.isArray(rows) ? rows : []).map(mapConversation);
    setConversations(mapped);
    if (!activeConversationId && mapped?.[0]?.id) setActiveConversationId(mapped[0].id);
  }, [activeChannelId, activeConversationId]);

  const loadMessages = useCallback(async () => {
    if (!activeConversation) return;
    const rows = await messagesService.listMessages({
      channelId: activeConversation.channelId,
      participantId: activeConversation.participantId,
      limit: PAGE_SIZE,
      offset: 0,
    });
    const mapped = (Array.isArray(rows) ? rows : []).map(mapMessage);
    setMessages(mapped);
    isAtBottomRef.current = true;
    setOffset(mapped.length);
    setHasMore(mapped.length === PAGE_SIZE);
    setHasUnreadNew(false);
  }, [activeConversation]);

  const loadMoreMessages = useCallback(async () => {
    if (!activeConversation || !hasMore || loadingMore) return;
    const container = messagesRef.current;
    const prevHeight = container ? container.scrollHeight : 0;
    const prevTop = container ? container.scrollTop : 0;
    setLoadingMore(true);
    try {
      const older = await messagesService.listMessages({
        channelId: activeConversation.channelId,
        participantId: activeConversation.participantId,
        limit: PAGE_SIZE,
        offset,
      });
      const rows = (Array.isArray(older) ? older : []).map(mapMessage);
      if (rows.length === 0) {
        setHasMore(false);
        return;
      }
      setMessages((prev) => [...rows, ...prev]);
      setOffset((prev) => prev + rows.length);
      setHasMore(rows.length === PAGE_SIZE);
      requestAnimationFrame(() => {
        if (!container) return;
        const nextHeight = container.scrollHeight;
        container.scrollTop = nextHeight - prevHeight + prevTop;
      });
    } finally {
      setLoadingMore(false);
    }
  }, [activeConversation, hasMore, loadingMore, offset]);

  useEffect(() => { loadBase(); }, [loadBase]);
  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => {
    activeChannelRef.current = activeChannelId;
    activeConversationRef.current = activeConversationId;
  }, [activeChannelId, activeConversationId]);
  useEffect(() => {
    if (isAtBottomRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const emitTyping = useCallback((isTyping) => {
    if (!capabilities.supportsTyping) return;
    const conv = conversations.find((c) => String(c.id) === String(activeConversationRef.current));
    if (!socketRef.current || !tenantIdRef.current || !activeChannelRef.current || !conv) return;
    socketRef.current.emit('message:typing', {
      channelId: activeChannelRef.current,
      channelType: conv.channelType,
      conversationId: conv.id,
      participantId: conv.participantId,
      contact: conv.participantId,
      tenantId: tenantIdRef.current,
      isTyping,
    });
  }, [capabilities.supportsTyping, conversations]);

  useEffect(() => {
    const token = agentApi.getToken();
    const tenantId = String(agentApi.getAgent()?.tenantId || agentApi.getAgent()?.tenant_id || '').trim();
    if (!token || !tenantId) return;
    tenantIdRef.current = tenantId;
    const socket = io(import.meta.env.VITE_API_URL || window.location.origin, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { token, tenantId },
      reconnection: true,
    });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('channels:subscribe', { tenantId }, () => {}));

    socket.on('message:new', (evt) => {
      if (!evt || String(evt.channelId) !== String(activeChannelRef.current)) return;
      const nextMsg = mapMessage({
        id: evt.messageId || `tmp_${evt.timestamp}_${evt.participantId || evt.contact}`,
        tenantId: evt.tenantId,
        channelId: evt.channelId,
        channelType: evt.channelType,
        conversationId: evt.conversationId,
        participantId: evt.participantId || evt.contact,
        senderType: evt.direction === 'inbound' ? 'customer' : 'agent',
        content: evt.message,
        timestamp: evt.timestamp,
        status: evt.status || 'SENT',
      });
      if (String(nextMsg.conversationId) === String(activeConversationRef.current)) {
        setMessages((prev) => [...prev, nextMsg]);
        if (!isAtBottomRef.current) setHasUnreadNew(true);
      }
      setConversations((prev) => {
        const next = [...prev];
        const idx = next.findIndex((c) => String(c.id) === String(nextMsg.conversationId));
        const patch = {
          id: nextMsg.conversationId,
          tenantId: nextMsg.tenantId,
          channelId: nextMsg.channelId,
          channelType: nextMsg.channelType,
          participantId: nextMsg.participantId,
          participantName: nextMsg.participantId,
          participantAvatar: null,
          participantHandle: null,
          lastMessage: nextMsg.content,
          lastMessageAt: nextMsg.timestamp,
          unreadCount: idx >= 0 && String(nextMsg.conversationId) !== String(activeConversationRef.current)
            ? Number(next[idx].unreadCount || 0) + 1
            : 0,
          status: nextMsg.status,
        };
        if (idx >= 0) next[idx] = { ...next[idx], ...patch };
        else next.unshift(patch);
        return next.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      });
    });

    socket.on('message:update', (evt) => {
      setMessages((prev) =>
        prev.map((m) =>
          evt?.messageId && String(m.id) === String(evt.messageId)
            ? { ...m, status: String(evt.status || m.status).toUpperCase() }
            : m
        )
      );
      loadConversations();
    });

    socket.on('message:typing', (evt) => {
      if (!evt || String(evt.channelId) !== String(activeChannelRef.current)) return;
      if (String(evt.conversationId || `${evt.channelId}:${evt.participantId || evt.contact}`) !== String(activeConversationRef.current)) return;
      if (evt.sourceSocketId && socketRef.current?.id && String(evt.sourceSocketId) === String(socketRef.current.id)) return;
      setTyping(Boolean(evt.isTyping));
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadConversations]);

  useEffect(() => {
    setTyping(false);
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    return () => {
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    };
  }, [activeChannelId, activeConversationId]);

  const onSend = async () => {
    const content = text.trim();
    if (!content || !activeConversation) return;
    setText('');
    emitTyping(false);
    await messagesService.sendMessage({
      channelId: activeConversation.channelId,
      channelType: activeConversation.channelType,
      conversationId: activeConversation.id,
      participantId: activeConversation.participantId,
      message: content,
    });
  };

  const onChangeText = (value) => {
    setText(value);
    emitTyping(Boolean(value.trim()));
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => emitTyping(false), 300);
  };

  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    if (el.scrollTop <= 16) loadMoreMessages();
  };

  const channelLabel = useMemo(() => {
    const t = activeConversation?.channelType || activeChannelType;
    return `${CHANNEL_ICON[t] || CHANNEL_ICON.unknown} ${t || 'unknown'}`;
  }, [activeConversation, activeChannelType]);

  return (
    <div style={styles.wrap}>
      <section style={styles.panel}>
        <div style={styles.header}>
          <select value={activeChannelId} onChange={(e) => setActiveChannelId(e.target.value)} style={styles.input}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {`${CHANNEL_ICON[normalizeChannelType(c.type)] || '🔘'} ${c.name || c.instance || c.id}`}
              </option>
            ))}
          </select>
        </div>
        <div style={styles.list}>
          {loading && <div style={styles.item}>Carregando...</div>}
          {conversations.map((c) => (
            <div
              key={c.id}
              style={{ ...styles.item, background: String(activeConversationId) === String(c.id) ? 'rgba(255,255,255,0.05)' : 'transparent' }}
              onClick={() => setActiveConversationId(c.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{c.participantName}</div>
                <span style={styles.chanBadge}>{CHANNEL_ICON[c.channelType] || '🔘'} {c.channelType}</span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>{c.participantId}</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{c.lastMessage}</div>
            </div>
          ))}
        </div>
      </section>
      <section style={styles.panel}>
        <div style={styles.header}>
          <div>
            <strong>{activeConversation?.participantName || 'Selecione uma conversa'}</strong>
            {activeConversation ? <div style={{ fontSize: 12, opacity: 0.75 }}>{activeConversation.participantId}</div> : null}
            {typing && capabilities.supportsTyping ? <span style={styles.typing}>Digitando...</span> : null}
          </div>
          <span style={styles.chanBadge}>{channelLabel}</span>
        </div>
        <div style={styles.messages} ref={messagesRef} onScroll={onMessagesScroll}>
          {loadingMore ? <div style={{ fontSize: 12, opacity: 0.75 }}>Carregando mensagens antigas...</div> : null}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              supportsDelivery={capabilities.supportsDelivery}
              supportsReadReceipts={capabilities.supportsReadReceipts}
            />
          ))}
          <div ref={endRef} />
        </div>
        {hasUnreadNew ? (
          <div style={{ padding: '0.4rem 0.75rem', fontSize: 12, color: 'var(--accent)', borderTop: '1px solid var(--border)' }}>
            Novas mensagens. Role para baixo para ver.
          </div>
        ) : null}
        <div style={styles.composer}>
          <input
            style={styles.input}
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
            placeholder="Digite sua mensagem..."
            onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
          />
          <button style={styles.button} onClick={onSend}>Enviar</button>
        </div>
      </section>
    </div>
  );
}

