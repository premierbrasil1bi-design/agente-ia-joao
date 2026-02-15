/**
 * Aplicação principal do Painel – navegação e carregamento das seções.
 * Separação: UI (este arquivo + sections) / API (api.js) / Backend (Express + Neon).
 */

import { api } from './api.js';

// Navegação por seção
const sections = document.querySelectorAll('.section');
const navLinks = document.querySelectorAll('.nav__link');

function showSection(sectionId) {
  sections.forEach((el) => el.classList.remove('active'));
  navLinks.forEach((el) => {
    el.classList.toggle('active', el.dataset.section === sectionId);
  });
  const el = document.getElementById(`section-${sectionId}`);
  if (el) el.classList.add('active');

  if (sectionId === 'dashboard') renderDashboard();
  if (sectionId === 'financeiro') renderFinanceiro();
  if (sectionId === 'canais') renderCanais();
  if (sectionId === 'prompts') renderPrompts();
  if (sectionId === 'mensagens') renderMensagens();
}

navLinks.forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const sectionId = link.dataset.section;
    window.location.hash = sectionId;
    showSection(sectionId);
  });
});

if (window.location.hash) {
  const id = window.location.hash.slice(1);
  if (['dashboard', 'financeiro', 'canais', 'prompts', 'mensagens'].includes(id)) {
    showSection(id);
  }
}

// ----- Dashboard -----
async function renderDashboard() {
  const cardsEl = document.getElementById('dashboard-cards');
  const alertasEl = document.getElementById('dashboard-alertas');
  cardsEl.innerHTML = '<div class="loading">Carregando...</div>';
  alertasEl.innerHTML = '';

  try {
    const data = await api.getSummary();
    cardsEl.innerHTML = `
      <div class="card">
        <div class="card__label">Gasto hoje</div>
        <div class="card__value">R$ ${Number(data.totalGastoHoje ?? 0).toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card__label">Gasto semana</div>
        <div class="card__value">R$ ${Number(data.totalGastoSemana ?? 0).toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card__label">Gasto mês</div>
        <div class="card__value">R$ ${Number(data.totalGastoMes ?? 0).toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card__label">Mensagens enviadas</div>
        <div class="card__value">${data.mensagensEnviadas ?? 0}</div>
      </div>
      <div class="card">
        <div class="card__label">Mensagens recebidas</div>
        <div class="card__value">${data.mensagensRecebidas ?? 0}</div>
      </div>
      <div class="card card--status ${(data.agentStatus || 'inativo')}">
        <div class="card__label">Status do agente</div>
        <div class="card__value">${(data.agentStatus || 'inativo')}</div>
      </div>
    `;
    if (data.alertas && data.alertas.length) {
      alertasEl.innerHTML = data.alertas
        .map((a) => `<div class="alerta alerta--${a.tipo || 'info'}">${a.texto}</div>`)
        .join('');
    }
  } catch (err) {
    cardsEl.innerHTML = `<div class="error">Erro ao carregar: ${err.message}</div>`;
  }
}

// ----- Financeiro -----
async function renderFinanceiro() {
  const el = document.getElementById('financeiro-content');
  el.innerHTML = '<div class="loading">Carregando...</div>';

  try {
    const [summary, costs] = await Promise.all([api.getSummary(), api.getCosts({})]);
    el.innerHTML = `
      <div class="cards" style="margin-bottom:1.5rem">
        <div class="card"><div class="card__label">Gasto hoje</div><div class="card__value">R$ ${Number(summary.totalGastoHoje ?? 0).toFixed(2)}</div></div>
        <div class="card"><div class="card__label">Gasto semana</div><div class="card__value">R$ ${Number(summary.totalGastoSemana ?? 0).toFixed(2)}</div></div>
        <div class="card"><div class="card__label">Gasto mês</div><div class="card__value">R$ ${Number(summary.totalGastoMes ?? 0).toFixed(2)}</div></div>
      </div>
      <h2 style="font-size:1rem; margin-bottom:0.5rem">Histórico de custos (simulado)</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Período</th><th>Total</th><th>Data</th></tr></thead>
          <tbody>
            ${Array.isArray(costs) && costs.length
              ? costs.slice(0, 10).map((c) => `<tr><td>${c.period || '-'}</td><td>R$ ${Number(c.total ?? c.amount ?? 0).toFixed(2)}</td><td>${c.recorded_at || '-'}</td></tr>`).join('')
              : '<tr><td colspan="3" class="empty">Nenhum registro. Configure Neon para persistir.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="error">Erro: ${err.message}</div>`;
  }
}

// ----- Canais -----
async function renderCanais() {
  const el = document.getElementById('canais-content');
  el.innerHTML = '<div class="loading">Carregando...</div>';

  try {
    const channels = await api.getChannels();
    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Canal</th><th>Tipo</th><th>Status</th><th>Ativo</th><th>Mensagens</th></tr></thead>
          <tbody>
            ${Array.isArray(channels) && channels.length
              ? channels.map((c) => `
                <tr>
                  <td>${c.name || c.type}</td>
                  <td>${c.type || '-'}</td>
                  <td><span class="badge badge--${(c.status || 'offline')}">${c.status || 'offline'}</span></td>
                  <td>${c.is_active !== false ? 'Sim' : 'Não'}</td>
                  <td>${c.message_count ?? 0}</td>
                </tr>
              `).join('')
              : '<tr><td colspan="5" class="empty">Nenhum canal. Configure Neon e crie canais.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="error">Erro: ${err.message}</div>`;
  }
}

// ----- Prompts -----
async function renderPrompts() {
  const el = document.getElementById('prompts-content');
  el.innerHTML = '<div class="loading">Carregando...</div>';

  try {
    const agents = await api.getAgents();
    const agentId = agents[0]?.id;
    if (!agentId) {
      el.innerHTML = '<p class="empty">Nenhum agente. Configure Neon e crie um agente.</p>';
      return;
    }
    const prompts = await api.getPrompts(agentId);
    el.innerHTML = `
      <p class="text-muted" style="color:var(--text-muted); margin-bottom:1rem">Prompt base e por canal (estrutura preparada para edição versionada).</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Canal (vazio = base)</th><th>Versão</th><th>Conteúdo</th></tr></thead>
          <tbody>
            ${Array.isArray(prompts) && prompts.length
              ? prompts.map((p) => `<tr><td>${p.channel_id ? 'Canal ' + p.channel_id : 'Base'}</td><td>${p.version ?? 1}</td><td>${(p.content || '').slice(0, 80)}${(p.content && p.content.length > 80) ? '…' : ''}</td></tr>`).join('')
              : '<tr><td colspan="3" class="empty">Nenhum prompt. Configure Neon e crie prompts.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="error">Erro: ${err.message}</div>`;
  }
}

// ----- Mensagens -----
async function renderMensagens() {
  const el = document.getElementById('mensagens-content');
  el.innerHTML = '<div class="loading">Carregando...</div>';

  try {
    const agents = await api.getAgents();
    const agentId = agents[0]?.id;
    if (!agentId) {
      el.innerHTML = '<p class="empty">Nenhum agente. Configure Neon.</p>';
      return;
    }
    const messages = await api.getMessages(agentId, null, 50, 0);
    el.innerHTML = `
      <p class="text-muted" style="color:var(--text-muted); margin-bottom:1rem">Histórico de mensagens (últimas 50). Filtro por canal preparado na API.</p>
      <div class="conversa">
        ${Array.isArray(messages) && messages.length
          ? messages.reverse().map((m) => `
            <div class="msg msg--${m.role}">
              <div class="msg__meta">${m.role} · ${m.created_at ? new Date(m.created_at).toLocaleString() : '-'}</div>
              <div>${escapeHtml(m.content || '')}</div>
            </div>
          `).join('')
          : '<p class="empty">Nenhuma mensagem. Use o chat para gerar histórico.</p>'}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="error">Erro: ${err.message}</div>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Carregar dashboard na entrada
renderDashboard();
