/**
 * Path-scoping policy. The single gatekeeper for every file-system tool call
 * the agent makes. Read / Write / Edit / Glob / Grep all flow through
 * `checkToolUse`, which decides allow / deny against a `TaskPolicy`.
 *
 * Defense-in-depth:
 *   - Symlinks are followed via realpath, so a symlink inside an allowed root
 *     pointing outside resolves to its target and fails the prefix check.
 *   - Non-existent destinations (a Write to a fresh file) are resolved against
 *     the closest existing ancestor, then re-attached.
 *   - Unknown tools and Bash fail closed.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './config.js';

export interface TaskPolicy {
  /** Absolute, realpath-resolved roots the task may read under. */
  readRoots: string[];
  /** Absolute, realpath-resolved roots the task may write under. */
  writeRoots: string[];
  /** Whether Bash is allowed at all. */
  allowBash: boolean;
  /** Whether WebFetch / WebSearch are allowed. */
  allowWeb: boolean;
}

/**
 * Per-task policy override authored in `tasks/<id>.json`. Paths are relative
 * to the repo root. Resolution is additive for roots (can grant more, never
 * narrow); booleans override outright.
 */
export interface TaskPolicyOverride {
  readRoots?: string[];
  writeRoots?: string[];
  allowBash?: boolean;
  allowWeb?: boolean;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

interface ToolPathSpec {
  field: string;
  mode: 'read' | 'write';
  /** If the path field is missing or empty, fall back to cwd. */
  defaultToCwd?: boolean;
}

const PATH_FIELDS: Record<string, ToolPathSpec> = {
  Read:  { field: 'file_path', mode: 'read'  },
  Write: { field: 'file_path', mode: 'write' },
  Edit:  { field: 'file_path', mode: 'write' },
  Glob:  { field: 'path',      mode: 'read', defaultToCwd: true },
  Grep:  { field: 'path',      mode: 'read', defaultToCwd: true },
};

/**
 * Extract the agent-provided target string from a tool input — for audit
 * records. Returns the raw value (not realpath-resolved); the realpath form
 * is already embedded in the policy verdict reason.
 */
export function extractTarget(toolName: string, input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const obj = input as Record<string, unknown>;
  const spec = PATH_FIELDS[toolName];
  if (spec) {
    const v = obj[spec.field];
    return typeof v === 'string' ? v : null;
  }
  if (toolName === 'Bash') {
    const v = obj.command;
    return typeof v === 'string' ? v : null;
  }
  if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    const v = obj.url ?? obj.query;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/** Repo-default policy. Realpaths the repo root once at construction time. */
export function defaultPolicy(repoRoot: string = REPO_ROOT): TaskPolicy {
  const repoReal = fsSync.realpathSync(repoRoot);
  return {
    readRoots: [repoReal],
    writeRoots: [
      path.join(repoReal, 'briefings'),
      path.join(repoReal, 'wiki'),
      path.join(repoReal, 'runs'),
    ],
    allowBash: false,
    allowWeb: true,
  };
}

/**
 * Validate a task's policy override shape at task-load time. Throws on
 * malformed input. No-op when override is undefined or null. Catches
 * common authoring typos (wrong types, non-array roots) before the task
 * ever fires.
 */
export function validateTaskPolicy(value: unknown, taskId: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`task '${taskId}': policy must be an object`);
  }
  const v = value as Record<string, unknown>;
  for (const field of ['readRoots', 'writeRoots'] as const) {
    if (v[field] === undefined) continue;
    if (!Array.isArray(v[field])) {
      throw new Error(`task '${taskId}': policy.${field} must be an array of strings`);
    }
    if ((v[field] as unknown[]).some((x) => typeof x !== 'string')) {
      throw new Error(`task '${taskId}': policy.${field} entries must be strings`);
    }
  }
  for (const field of ['allowBash', 'allowWeb'] as const) {
    if (v[field] !== undefined && typeof v[field] !== 'boolean') {
      throw new Error(`task '${taskId}': policy.${field} must be a boolean`);
    }
  }
}

/**
 * Build the effective TaskPolicy from defaults plus an optional override.
 * Roots are additive: per-task entries are added to defaults, never replace.
 * Booleans (`allowBash`, `allowWeb`) override outright. To narrow defaults
 * for all tasks, edit `defaultPolicy` here, not per-task overrides.
 */
export function resolvePolicy(
  override: TaskPolicyOverride | undefined,
  repoRoot: string = REPO_ROOT,
): TaskPolicy {
  const base = defaultPolicy(repoRoot);
  if (!override) return base;

  const repoReal = fsSync.realpathSync(repoRoot);
  const extend = (existing: string[], extras?: string[]): string[] => {
    if (!extras || extras.length === 0) return existing;
    const set = new Set(existing);
    for (const p of extras) set.add(path.resolve(repoReal, p));
    return Array.from(set);
  };

  return {
    readRoots: extend(base.readRoots, override.readRoots),
    writeRoots: extend(base.writeRoots, override.writeRoots),
    allowBash: override.allowBash ?? base.allowBash,
    allowWeb: override.allowWeb ?? base.allowWeb,
  };
}

/**
 * Resolve a possibly-not-yet-existing path to its real absolute form.
 * Walks up the tree to find the closest existing ancestor, realpaths that,
 * then re-attaches the trailing components. For existing files, equivalent
 * to a plain realpath.
 */
async function realpathSafe(absPath: string): Promise<string> {
  try {
    return await fs.realpath(absPath);
  } catch {
    let dir = path.dirname(absPath);
    const tail: string[] = [path.basename(absPath)];
    while (dir !== path.dirname(dir)) {
      try {
        const real = await fs.realpath(dir);
        return path.join(real, ...tail.reverse());
      } catch {
        tail.push(path.basename(dir));
        dir = path.dirname(dir);
      }
    }
    return absPath;
  }
}

/** True if `child` is `root` or strictly inside it (separator-boundary). */
function isInside(child: string, root: string): boolean {
  const c = child.endsWith(path.sep) ? child.slice(0, -1) : child;
  const r = root.endsWith(path.sep) ? root.slice(0, -1) : root;
  return c === r || c.startsWith(r + path.sep);
}

/**
 * The single gatekeeper. Returns `{ allowed: true }` or `{ allowed: false, reason }`.
 * `cwd` is used to resolve relative path fields and is the fallback for
 * Glob / Grep when `path` is omitted.
 */
export async function checkToolUse(
  toolName: string,
  input: Record<string, unknown>,
  policy: TaskPolicy,
  cwd: string = REPO_ROOT,
): Promise<PolicyDecision> {
  if (toolName === 'WebSearch' || toolName === 'WebFetch') {
    return policy.allowWeb
      ? { allowed: true }
      : { allowed: false, reason: `${toolName} disabled by policy` };
  }

  if (toolName === 'Bash') {
    return policy.allowBash
      ? { allowed: true }
      : { allowed: false, reason: 'Bash disabled by policy' };
  }

  const spec = PATH_FIELDS[toolName];
  if (!spec) {
    return { allowed: false, reason: `tool '${toolName}' not in policy registry (fail-closed)` };
  }

  const raw = input[spec.field];
  let candidate: string;
  if (typeof raw === 'string' && raw.length > 0) {
    candidate = raw;
  } else if (spec.defaultToCwd) {
    candidate = cwd;
  } else {
    return { allowed: false, reason: `missing path field '${spec.field}' for ${toolName}` };
  }

  const abs = path.resolve(cwd, candidate);
  const real = await realpathSafe(abs);

  const roots = spec.mode === 'write' ? policy.writeRoots : policy.readRoots;
  const inside = roots.some((r) => isInside(real, r));
  if (!inside) {
    return {
      allowed: false,
      reason: `${spec.mode} of '${real}' is outside policy ${spec.mode}Roots`,
    };
  }

  return { allowed: true };
}
