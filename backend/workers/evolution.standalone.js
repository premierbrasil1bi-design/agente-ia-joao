/**
 * Processo dedicado apenas ao worker Evolution (PM2: script separado).
 * Ex.: node workers/evolution.standalone.js
 */

import 'dotenv/config';
import { initEvolutionQueueInfra } from '../queues/evolution.queue.js';
import { startEvolutionWorker } from './evolution.worker.js';

(async () => {
  await initEvolutionQueueInfra();
  startEvolutionWorker();
  console.log('[evolution.standalone] worker Evolution escutando fila evolution-api');
})().catch((e) => {
  console.error('[evolution.standalone]', e);
  process.exit(1);
});
