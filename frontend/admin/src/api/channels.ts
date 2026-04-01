import { agentApi } from '../services/agentApi.js';

export async function connectChannel(id: string) {
  return agentApi.request(`/api/channels/${id}/provision-instance`, {
    method: 'POST',
  });
}

export async function getQRCode(id: string) {
  return agentApi.request(`/api/channels/${id}/qrcode`, {
    method: 'GET',
  });
}

export async function getStatus(id: string) {
  return agentApi.request(`/api/channels/${id}/status`, {
    method: 'GET',
  });
}
