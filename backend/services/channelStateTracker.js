const channelStateMap = new Map();

function toKey(tenantId, channelId) {
  return `${String(tenantId)}:${String(channelId)}`;
}

export function trackChannelState({ tenantId, channelId, status }) {
  if (!tenantId || !channelId) return;
  channelStateMap.set(toKey(tenantId, channelId), {
    tenantId: String(tenantId),
    channelId: String(channelId),
    status: String(status || 'connecting').toLowerCase(),
    updatedAt: Date.now(),
  });
}

export function getTrackedChannelStates(tenantId = null) {
  const list = Array.from(channelStateMap.values());
  if (!tenantId) return list;
  return list.filter((item) => String(item.tenantId) === String(tenantId));
}

export function getTrackedCounts(tenantId = null) {
  const list = getTrackedChannelStates(tenantId);
  const out = {
    total: list.length,
    connected: 0,
    error: 0,
    waiting: 0,
    connecting: 0,
  };
  for (const item of list) {
    if (item.status === 'connected') out.connected += 1;
    else if (item.status === 'error') out.error += 1;
    else if (item.status === 'waiting' || item.status === 'ready') out.waiting += 1;
    else out.connecting += 1;
  }
  return out;
}
