
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import { config } from './config/env.js';
import { channelContext, setChannelActiveHeader } from './middleware/channelContext.js';
import { getPool, isDbConnected } from './db/connection.js';
import inboundRoutes from './routes/inboundRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import agentsRoutes from './routes/agentsRoutes.js';
import contextRoutes from './routes/contextRoutes.js';
import authRoutes from './routes/authRoutes.js';
import agentAuthRoutes from './routes/agentAuth.routes.js';
import evolutionWebhookRoutes from './routes/evolutionWebhook.routes.js';
import { agentOrAdminAuth } from './middleware/agentOrAdminAuth.js';
import { sendNotFound, sendServerError } from './utils/errorResponses.js';

dotenv.config();

// Caso precise de __dirname em algum lugar:
// import { fileURLToPath } from 'url';
// import { dirname } from 'path';
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

getPool();

const app = express();
const PORT = config.port;

// Middlewares
app.use(cors());
app.use(express.json());
// Evolution Webhook
app.use('/api', evolutionWebhookRoutes);
app.use('/api', evolutionWebhookRoutes);

// Rotas de saúde (antes do middleware de canal)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend is running' });
});
app.get('/api/health/db', async (req, res) => {
  try {
    const connected = await isDbConnected();
    res.status(200).json({ database: connected ? 'connected' : 'disconnected' });
  } catch {
    res.status(503).json({ database: 'disconnected', error: 'Unavailable' });
  }
});

// Identificação do canal ativo em todas as rotas /api (query ?channel=, header x-channel, fallback WEB)
app.use('/api', channelContext);
app.use('/api', setChannelActiveHeader);

// GET /api/context – retorna client_id, agent_id, channel, prompt_id, canal_nome
app.use('/api', contextRoutes);

// Rotas /api/* devem vir ANTES de /api/agent para não serem confundidas (agents vs agent)
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', agentOrAdminAuth, dashboardRoutes);
app.use('/api/agents', agentOrAdminAuth, agentsRoutes);

// AGENTE IA OMNICANAL: auth e dashboard (agent_token / agent_user – isolado do SIS-ACOLHE)
app.use('/api/agent', agentAuthRoutes);

// Rota principal: POST /api/agent/message (e GET retorna 405)
app.use('/api/agent', inboundRoutes);

// POST /message também funciona (mesmo handler), para quem chamar sem o prefixo /api/agent

// Webhook Evolution
// axios já importado no topo
app.post('/webhook/evolution', async (req, res) => {
  try {
    const { event, data } = req.body || {};
    if (event !== 'messages.upsert') {
      return res.status(200).json({ status: "ignorado" });
    }
    if (data?.fromMe === true) {
      return res.status(200).json({ status: "ignorado" });
    }
    const texto = data?.message?.conversation;
    const numero = data?.key?.remoteJid;
    if (!texto || !numero) {
      return res.status(200).json({ status: "ignorado" });
    }
    // Envia para o agente
    const agentResponse = await axios.post(
      `${req.protocol}://${req.get('host')}/api/agent/message`,
      {
        text: texto,
        agent_id: "b5144047-b7a8-4c17-ab42-46b6bbf2ac51"
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    const respostaAgente = agentResponse?.data?.text || agentResponse?.data?.response || 'OK';
    // Envia resposta para Evolution
    if (!process.env.EVOLUTION_API_URL) {
      console.error('EVOLUTION_API_URL não configurada no .env');
      throw new Error('EVOLUTION_API_URL não configurada no .env');
    }
    if (!process.env.EVOLUTION_API_KEY) {
      console.error('EVOLUTION_API_KEY não configurada no .env');
      throw new Error('EVOLUTION_API_KEY não configurada no .env');
    }
    await axios.post(
      process.env.EVOLUTION_API_URL,
      {
        number: numero,
        text: respostaAgente
      },
      {
        headers: {
          apikey: process.env.EVOLUTION_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    res.status(200).json({ status: "recebido" });
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).json({ error: "Erro interno no webhook" });
  }
});

app.use('/', inboundRoutes);

app.use((req, res) => sendNotFound(res, 'Rota não encontrada.'));

app.use((err, req, res, next) => {
  const msg = err?.message || String(err);
  console.error('[API error]', msg);
  const clientMsg =
    config.env !== 'production' && msg ? msg : 'Erro interno do servidor.';
  sendServerError(res, clientMsg, err);
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor de backend rodando na porta ${PORT}`);
  console.log(`Endpoint principal do agente: POST http://localhost:${PORT}/message`);
});
