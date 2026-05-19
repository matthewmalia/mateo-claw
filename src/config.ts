/**
 * Configuration constants. Following the NanoClaw philosophy of
 * "customization equals code changes" rather than configuration sprawl —
 * if you want different behavior, edit this file.
 */

import path from 'node:path';

export const REPO_ROOT = process.cwd();
export const TASKS_DIR = path.join(REPO_ROOT, 'tasks');
export const RUNS_DIR = path.join(REPO_ROOT, 'runs');
export const WIKI_DIR = path.join(REPO_ROOT, 'wiki');
export const RAW_DIR = path.join(REPO_ROOT, 'raw');

/** How often the scheduler loop polls for due tasks. */
export const SCHEDULER_POLL_INTERVAL_MS = 30_000;

/** Floor on `interval`-type schedules. Anything below this is refused — guard against runaway loops eating Max-subscription quota. */
export const MIN_INTERVAL_MS = 5 * 60_000;

/** Default model when a task doesn't override. Cheap by default; tasks that need more pick a beefier model explicitly. */
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/** Default tools allowed when a task doesn't specify its own list. */
export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
];

/** Timezone used to evaluate cron expressions. Override via TZ env var. */
export const TIMEZONE = process.env.TZ ?? 'America/New_York';
