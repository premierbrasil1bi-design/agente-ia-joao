import { AGENT_ID } from '../config/agent.js';
import { agentApi } from './agentApi.js';

export async function sendMessage(text) {
  return agentApi.request('/api/agent/message', {
    method: 'POST',
    body: JSON.stringify({
      text,
      agent_id: AGENT_ID,
    }),
  });
}
