/**
 * PM2 — API + worker BullMQ (Evolution).
 * Rode na raiz do repositório: pm2 start ecosystem.config.js
 *
 * REDIS_URL: repasse do ambiente do shell ao executar pm2 (ex.: source backend/.env no deploy).
 */

const root = __dirname;

const sharedEnv = {
  NODE_ENV: process.env.NODE_ENV || 'production',
  REDIS_URL: process.env.REDIS_URL || '',
  EVOLUTION_WORKER_CONCURRENCY: process.env.EVOLUTION_WORKER_CONCURRENCY || '3',
};

module.exports = {
  apps: [
    {
      name: 'agente-backend',
      script: 'backend/server.js',
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/agente-backend-error.log',
      out_file: './logs/agente-backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      merge_logs: true,
      env: {
        ...sharedEnv,
        EVOLUTION_WORKER_IN_PROCESS: 'false',
      },
    },
    {
      name: 'worker-evolution',
      script: 'backend/workers/evolution.worker.js',
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/worker-evolution-error.log',
      out_file: './logs/worker-evolution-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      merge_logs: true,
      env: {
        ...sharedEnv,
      },
    },
  ],
};
