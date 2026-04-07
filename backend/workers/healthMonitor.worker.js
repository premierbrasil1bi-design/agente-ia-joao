import { runHealthMonitor } from '../jobs/channelHealthMonitor.js';

async function loop() {
  while (true) {
    try {
      await runHealthMonitor();
    } catch (err) {
      console.error('[MONITOR ERROR]', err?.message || err);
    }
    await new Promise((r) => setTimeout(r, 30000));
  }
}

loop();
