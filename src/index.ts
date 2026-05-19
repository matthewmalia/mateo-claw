/**
 * Personal agent — main entry point.
 *
 * Starts the scheduler loop. Tasks are read from `tasks/*.json`. Run records
 * are written to `runs/YYYY-MM-DD/`. Wire `npm start` into launchd (macOS)
 * or equivalent so the agent stays alive across reboots.
 */

import { startSchedulerLoop } from './scheduler.js';

async function main(): Promise<void> {
  console.log('[main] personal agent starting');

  const stop = startSchedulerLoop();

  const shutdown = (signal: string): void => {
    console.log(`[main] ${signal} received, shutting down`);
    stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('[main] running');
}

main().catch((err) => {
  console.error('[main] fatal:', err);
  process.exit(1);
});
