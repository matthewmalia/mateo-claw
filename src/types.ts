/**
 * Core data types for the personal agent.
 */

import type { TaskPolicy, TaskPolicyOverride } from './policy.js';

export type ScheduleType = 'cron' | 'interval' | 'once';

export interface Task {
  /** Stable identifier. Use kebab-case. Filename is `${id}.json`. */
  id: string;
  /** Human-readable description of what this task does. */
  description: string;
  /** The prompt sent to the agent when this task fires. */
  prompt: string;
  /** Schedule type. */
  scheduleType: ScheduleType;
  /**
   * Schedule value:
   *   - cron:     a cron expression, e.g. "0 7 * * 1-5"
   *   - interval: milliseconds (as string), e.g. "3600000"
   *   - once:     ISO timestamp the task should run at
   */
  scheduleValue: string;
  /** Whether this task is currently active. */
  enabled: boolean;
  /** ISO string of the next scheduled run. Null when a once-task is done or before first compute. */
  nextRun: string | null;
  /** ISO string of the last run, or null. */
  lastRun: string | null;
  /** Status of the last run, if any. */
  lastStatus?: 'success' | 'error';
  /** Tools the agent is allowed to use for this task. Defaults from config. */
  allowedTools?: string[];
  /** Model override (e.g. 'claude-sonnet-4-6'). Defaults to config DEFAULT_MODEL. */
  model?: string;
  /**
   * Per-task policy override. Read/write roots are additive to defaults
   * (paths relative to repo root). Booleans override defaults outright.
   * See `src/policy.ts` for the resolution rules and `defaultPolicy`.
   */
  policy?: TaskPolicyOverride;
}

export interface PolicyDenial {
  /** Tool name, e.g. "Write", "Read", "Bash". */
  tool: string;
  /** Policy verdict reason — typically includes the realpath-resolved target. */
  reason: string;
  /** Raw target the agent passed (file_path / path / command / url). Null for unknown tools. */
  target: string | null;
}

export interface RunRecord {
  taskId: string;
  /** ISO timestamp the run started. */
  startedAt: string;
  /** ISO timestamp the run finished. */
  finishedAt: string;
  status: 'success' | 'error';
  /** The prompt that was sent. Captured for audit/replay. */
  prompt: string;
  /** Model used for the run. */
  model: string;
  /** Final text response from the agent, if any. */
  result?: string;
  /** Error message, if status is 'error'. */
  error?: string;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Policy denials encountered during the run, if any. */
  denials?: PolicyDenial[];
}

export interface AgentInvocation {
  /** Identifier for logging — taskId for scheduled tasks, 'manual' for ad-hoc. */
  invocationId: string;
  /** The prompt to send. */
  prompt: string;
  /** Model to use. Defaults from config if omitted. */
  model?: string;
  /** Tools to allow. Defaults from config if omitted. */
  allowedTools?: string[];
  /** Resolved policy. If omitted, runAgent applies the default policy. */
  policy?: TaskPolicy;
}

export interface AgentResult {
  status: 'success' | 'error';
  result?: string;
  error?: string;
  durationMs: number;
  /** Policy denials encountered during the run, if any. */
  denials?: PolicyDenial[];
}
