/**
 * The scheduler loop. Polls task files, computes due-time, invokes the agent
 * sequentially when tasks are ready.
 *
 * Schedule types:
 *   - cron:     scheduleValue is a cron expression (e.g. "0 7 * * 1-5")
 *   - interval: scheduleValue is milliseconds as a string; floored at MIN_INTERVAL_MS
 *   - once:     scheduleValue is an ISO timestamp; task auto-disables after one run
 *
 * Lazy nextRun: if a task is enabled but has nextRun: null (newly authored),
 * the scheduler computes it on first sight. Once-tasks that have completed
 * (lastRun set, nextRun cleared, enabled false) stay terminal.
 */

import { CronExpressionParser } from 'cron-parser';
import {
  DEFAULT_MODEL,
  MIN_INTERVAL_MS,
  REPO_ROOT,
  SCHEDULER_POLL_INTERVAL_MS,
  TIMEZONE,
} from './config.js';
import { loadTasks, saveTask, saveRunRecord } from './storage.js';
import { runAgent } from './agent.js';
import { resolvePolicy } from './policy.js';
import type { RunRecord, Task } from './types.js';

/**
 * Compute the next run time for a task based on its schedule. Returns an
 * ISO timestamp. Throws on invalid schedule values; the caller decides
 * whether to log-and-skip or surface the error.
 */
export function computeNextRun(task: Task, from: Date = new Date()): string {
  switch (task.scheduleType) {
    case 'cron': {
      const interval = CronExpressionParser.parse(task.scheduleValue, {
        tz: TIMEZONE,
        currentDate: from,
      });
      // cron-parser's CronDate.toISOString() can return null on invalid dates.
      const next = interval.next().toISOString();
      if (!next) {
        throw new Error(
          `cron-parser produced no next time for task ${task.id}: ${task.scheduleValue}`,
        );
      }
      return next;
    }
    case 'interval': {
      const ms = parseInt(task.scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) {
        throw new Error(`Invalid interval for task ${task.id}: ${task.scheduleValue}`);
      }
      if (ms < MIN_INTERVAL_MS) {
        throw new Error(
          `Interval ${ms}ms below floor ${MIN_INTERVAL_MS}ms for task ${task.id}`,
        );
      }
      return new Date(from.getTime() + ms).toISOString();
    }
    case 'once': {
      const target = new Date(task.scheduleValue);
      if (isNaN(target.getTime())) {
        throw new Error(`Invalid once timestamp for task ${task.id}: ${task.scheduleValue}`);
      }
      return target.toISOString();
    }
  }
}

/**
 * Bootstrap nextRun for tasks that are enabled but have null nextRun
 * (typically freshly authored). No-op for terminal once-tasks (already
 * run) and for disabled tasks.
 */
async function ensureNextRun(task: Task): Promise<void> {
  if (task.nextRun) return;
  if (!task.enabled) return;
  // A once-task that has already run stays terminal.
  if (task.scheduleType === 'once' && task.lastRun) return;

  try {
    task.nextRun = computeNextRun(task);
    await saveTask(task);
    console.log(`[scheduler] bootstrapped nextRun for ${task.id}: ${task.nextRun}`);
  } catch (err) {
    console.error(`[scheduler] cannot bootstrap nextRun for ${task.id}:`, err);
  }
}

/** Run a single task: invoke agent, write run record, update task state. */
export async function runTask(task: Task): Promise<RunRecord> {
  const startedAt = new Date().toISOString();
  const model = task.model ?? DEFAULT_MODEL;

  const result = await runAgent({
    invocationId: task.id,
    prompt: task.prompt,
    model: task.model,
    allowedTools: task.allowedTools,
    policy: resolvePolicy(task.policy, REPO_ROOT),
  });

  const finishedAt = new Date().toISOString();

  const record: RunRecord = {
    taskId: task.id,
    startedAt,
    finishedAt,
    status: result.status,
    prompt: task.prompt,
    model,
    result: result.result,
    error: result.error,
    durationMs: result.durationMs,
    denials: result.denials,
  };
  await saveRunRecord(record);

  task.lastRun = finishedAt;
  task.lastStatus = result.status;
  if (task.scheduleType === 'once') {
    task.nextRun = null;
    task.enabled = false; // Auto-disable completed once-tasks.
  } else {
    try {
      task.nextRun = computeNextRun(task);
    } catch (err) {
      console.error(`[scheduler] failed to compute next run for ${task.id}:`, err);
      task.nextRun = null; // Leave disabled-by-missing-nextRun; user fixes the schedule.
    }
  }
  await saveTask(task);

  return record;
}

// In-memory guard against concurrent runs of the same task. Belt-and-suspenders
// alongside the serialized loop in startSchedulerLoop — protects against any
// future re-entrancy bug. On process restart this set starts empty, which is
// correct: a task killed mid-run should be eligible to fire again.
const runningTasks = new Set<string>();

/** One pass of the scheduler: bootstrap fresh tasks, find due tasks, run them. */
async function tick(): Promise<void> {
  const tasks = await loadTasks();

  // Bootstrap freshly authored tasks (nextRun: null + enabled).
  for (const task of tasks) {
    await ensureNextRun(task);
  }

  const now = new Date();
  const due = tasks.filter((t) => {
    if (!t.enabled) return false;
    if (!t.nextRun) return false;
    if (runningTasks.has(t.id)) return false;
    return new Date(t.nextRun) <= now;
  });

  if (due.length === 0) return;

  console.log(`[scheduler] ${due.length} task(s) due`);

  // Sequential execution — avoids cost spikes and keeps logs readable.
  // For parallel execution, swap for `await Promise.all(due.map(runTask))`.
  for (const task of due) {
    runningTasks.add(task.id);
    try {
      await runTask(task);
    } catch (err) {
      console.error(`[scheduler] task ${task.id} threw:`, err);
    } finally {
      runningTasks.delete(task.id);
    }
  }
}

/**
 * Start the polling loop. Returns a stop function.
 *
 * Uses a chained setTimeout instead of setInterval so ticks naturally
 * serialize: the next tick is scheduled only after the previous one resolves.
 * setInterval would fire ticks regardless of in-flight work causing
 * concurrent runs of a single long task before its post-run state would save.
 */
export function startSchedulerLoop(): () => void {
  console.log(`[scheduler] starting (poll every ${SCHEDULER_POLL_INTERVAL_MS}ms)`);

  let stopped = false;

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        await tick();
      } catch (err) {
        console.error('[scheduler] tick failed:', err);
      }
      if (stopped) break;
      await new Promise<void>((resolve) => setTimeout(resolve, SCHEDULER_POLL_INTERVAL_MS));
    }
    console.log('[scheduler] loop exited');
  }

  void loop();

  return () => {
    console.log('[scheduler] stopping');
    stopped = true;
  };
}
