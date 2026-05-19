/**
 * Manually fire a single task by id, ignoring its schedule. Useful for
 * testing a task's prompt before letting the scheduler fire it on cron.
 *
 * Usage:
 *   npm run run-task -- <task-id>
 *   tsx src/run-task.ts morning-briefing
 */

import { loadTask } from './storage.js';
import { runTask } from './scheduler.js';

async function main(): Promise<void> {
  const taskId = process.argv[2];
  if (!taskId) {
    console.error('Usage: tsx src/run-task.ts <task-id>');
    process.exit(1);
  }

  const task = await loadTask(taskId);
  if (!task) {
    console.error(`No task found with id: ${taskId}`);
    process.exit(1);
  }

  console.log(`[run-task] firing ${taskId}`);
  const record = await runTask(task);
  console.log(`[run-task] done. status=${record.status} duration=${record.durationMs}ms`);
  process.exit(record.status === 'success' ? 0 : 1);
}

main().catch((err) => {
  console.error('[run-task] fatal:', err);
  process.exit(1);
});
