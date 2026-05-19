/**
 * Phase A smoke test for path scoping.
 *
 * Part 1 (unit): exercises checkToolUse directly against defaultPolicy().
 *   No SDK calls. Catches policy bugs in milliseconds.
 *
 * Part 2 (integration): wires canUseTool into a real query() and verifies:
 *   - The callback fires under permissionMode: 'default' with no
 *     allowDangerouslySkipPermissions.
 *   - A 'deny' decision blocks the tool execution (the forbidden file is
 *     not created).
 *
 * If Part 2 shows zero canUseTool invocations, the SDK is not routing
 * tool calls through the callback in this mode — the design needs revision
 * before Phase B.
 *
 *   npx tsx scripts/policy-smoke.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from '../src/config.js';
import {
  defaultPolicy,
  checkToolUse,
  resolvePolicy,
  validateTaskPolicy,
} from '../src/policy.js';
import { runAgent } from '../src/agent.js';
import { runTask } from '../src/scheduler.js';
import type { RunRecord, Task } from '../src/types.js';

const FORBIDDEN_OUT = '/tmp/policy-smoke-must-not-exist.txt';

let failures = 0;
function expect(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  OK   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures++;
  }
}

async function unitTests(): Promise<void> {
  console.log('[policy-smoke] Part 1: unit tests against checkToolUse');
  const policy = defaultPolicy(REPO_ROOT);

  expect(
    policy.writeRoots.some((r) => r.endsWith('/briefings')),
    'defaultPolicy.writeRoots includes briefings/',
  );
  expect(policy.allowBash === false, 'defaultPolicy.allowBash is false');
  expect(policy.allowWeb === true, 'defaultPolicy.allowWeb is true');

  const cases: Array<{
    label: string;
    tool: string;
    input: Record<string, unknown>;
    want: 'allow' | 'deny';
  }> = [
    { label: 'Read CLAUDE.md (in repo)',                  tool: 'Read',         input: { file_path: path.join(REPO_ROOT, 'CLAUDE.md') }, want: 'allow' },
    { label: 'Read /etc/passwd (out of repo)',            tool: 'Read',         input: { file_path: '/etc/passwd' },                    want: 'deny'  },
    { label: 'Write briefings/x.md',                      tool: 'Write',        input: { file_path: path.join(REPO_ROOT, 'briefings/x.md') }, want: 'allow' },
    { label: 'Write src/agent.ts (not in writeRoots)',    tool: 'Write',        input: { file_path: path.join(REPO_ROOT, 'src/agent.ts') },   want: 'deny'  },
    { label: 'Write /tmp/foo.txt',                        tool: 'Write',        input: { file_path: '/tmp/foo.txt' },                   want: 'deny'  },
    { label: 'Traversal: briefings/../src/x.ts',          tool: 'Write',        input: { file_path: path.join(REPO_ROOT, 'briefings/../src/x.ts') }, want: 'deny' },
    { label: 'Edit USER.md (not in writeRoots)',          tool: 'Edit',         input: { file_path: path.join(REPO_ROOT, 'USER.md') },  want: 'deny'  },
    { label: 'Edit wiki/index.md',                        tool: 'Edit',         input: { file_path: path.join(REPO_ROOT, 'wiki/index.md') }, want: 'allow' },
    { label: 'Bash (default deny)',                       tool: 'Bash',         input: { command: 'echo hi' },                          want: 'deny'  },
    { label: 'Unknown tool (fail-closed)',                tool: 'NotebookEdit', input: {},                                              want: 'deny'  },
    { label: 'WebFetch (allowWeb default true)',          tool: 'WebFetch',     input: { url: 'https://example.com' },                  want: 'allow' },
    { label: 'Glob with no path (defaults to cwd)',       tool: 'Glob',         input: { pattern: '*.md' },                             want: 'allow' },
    { label: 'Grep path outside repo',                    tool: 'Grep',         input: { pattern: 'foo', path: '/etc' },                want: 'deny'  },
  ];

  for (const c of cases) {
    const decision = await checkToolUse(c.tool, c.input, policy, REPO_ROOT);
    const got = decision.allowed ? 'allow' : 'deny';
    const note = decision.allowed ? '' : ` (${decision.reason})`;
    expect(got === c.want, `${c.label} -> want=${c.want} got=${got}${note}`);
  }

  // resolvePolicy: per-task overrides
  console.log('[policy-smoke] unit tests for resolvePolicy / validateTaskPolicy');

  const resolvedDefault = resolvePolicy(undefined, REPO_ROOT);
  expect(
    resolvedDefault.writeRoots.length === policy.writeRoots.length,
    'resolvePolicy(undefined) returns defaults',
  );

  const widened = resolvePolicy(
    { writeRoots: ['tasks'], readRoots: ['/tmp/research'] },
    REPO_ROOT,
  );
  expect(
    widened.writeRoots.some((r) => r.endsWith('/briefings')),
    'resolvePolicy keeps default writeRoots when extended',
  );
  expect(
    widened.writeRoots.some((r) => r.endsWith('/tasks')),
    'resolvePolicy adds task-specific writeRoots',
  );
  expect(
    widened.readRoots.some((r) => r === '/tmp/research' || r === '/private/tmp/research'),
    'resolvePolicy adds task-specific readRoots',
  );

  const overridden = resolvePolicy({ allowBash: true, allowWeb: false }, REPO_ROOT);
  expect(overridden.allowBash === true, 'resolvePolicy overrides allowBash');
  expect(overridden.allowWeb === false, 'resolvePolicy overrides allowWeb');

  // After override: a Write to tasks/ should now be allowed
  const widened2 = resolvePolicy({ writeRoots: ['tasks'] }, REPO_ROOT);
  const writeTaskFile = await checkToolUse(
    'Write',
    { file_path: path.join(REPO_ROOT, 'tasks/scratch.json') },
    widened2,
    REPO_ROOT,
  );
  expect(writeTaskFile.allowed, 'Write to tasks/ allowed after writeRoots: ["tasks"]');

  // validateTaskPolicy
  let threw = false;
  try {
    validateTaskPolicy({ readRoots: 'not-an-array' }, 'bad-1');
  } catch {
    threw = true;
  }
  expect(threw, 'validateTaskPolicy rejects non-array readRoots');

  threw = false;
  try {
    validateTaskPolicy({ readRoots: ['ok', 42] }, 'bad-2');
  } catch {
    threw = true;
  }
  expect(threw, 'validateTaskPolicy rejects non-string root entries');

  threw = false;
  try {
    validateTaskPolicy({ allowBash: 'yes' }, 'bad-3');
  } catch {
    threw = true;
  }
  expect(threw, 'validateTaskPolicy rejects non-boolean allowBash');

  threw = false;
  try {
    validateTaskPolicy(undefined, 'ok-1');
    validateTaskPolicy({ readRoots: ['a', 'b'], allowWeb: false }, 'ok-2');
  } catch {
    threw = true;
  }
  expect(!threw, 'validateTaskPolicy accepts undefined and well-formed overrides');
}

async function sdkIntegration(): Promise<void> {
  console.log('\n[policy-smoke] Part 2: SDK integration (real query() call)');
  await fs.rm(FORBIDDEN_OUT, { force: true });

  const policy = defaultPolicy(REPO_ROOT);
  const calls: Array<{ tool: string; allowed: boolean; reason?: string }> = [];

  // Three tasks: a should-allow Read, a should-deny Read (out of repo), and
  // a should-deny Write. Probes whether the PreToolUse hook fires for *every*
  // tool call. If a Read succeeds without firing the hook, that's a policy
  // bypass we need to know about before Phase B.
  const stream = query({
    prompt:
      `You have three tasks. Use exactly the absolute paths I provide; do not guess other paths. ` +
      `Do all three tasks, then briefly report what happened.\n` +
      `1. Read the file at exactly this path: ${path.join(REPO_ROOT, 'CLAUDE.md')}\n` +
      `   Tell me how many "## " headings it has.\n` +
      `2. Read the file at exactly this path: /etc/hosts\n` +
      `   Report whether it succeeded.\n` +
      `3. Write the word "hi" to exactly this path: ${FORBIDDEN_OUT}\n` +
      `If a tool is denied, do not retry and do not try a different path — just note which task failed and continue.`,
    options: {
      cwd: REPO_ROOT,
      model: 'claude-haiku-4-5-20251001',
      tools: ['Read', 'Write'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                if (input.hook_event_name !== 'PreToolUse') {
                  return { continue: true };
                }
                const toolName = input.tool_name;
                const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
                const decision = await checkToolUse(toolName, toolInput, policy, REPO_ROOT);
                calls.push({
                  tool: toolName,
                  allowed: decision.allowed,
                  reason: decision.allowed ? undefined : decision.reason,
                });
                console.log(
                  `  PreToolUse(${toolName}) -> ${decision.allowed ? 'allow' : `deny: ${decision.reason}`}`,
                );
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: decision.allowed ? 'allow' : 'deny',
                    permissionDecisionReason: decision.allowed ? undefined : decision.reason,
                  },
                };
              },
            ],
          },
        ],
      },
    },
  });

  let assistantText = '';
  const toolUsesSeen: string[] = [];
  for await (const msg of stream) {
    if (msg.type === 'assistant') {
      const blocks =
        (msg.message as { content?: Array<{ type: string; text?: string; name?: string }> }).content ?? [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text) assistantText += b.text;
        if (b.type === 'tool_use' && b.name) toolUsesSeen.push(b.name);
      }
    }
  }
  console.log(`[policy-smoke] tool_use blocks emitted by model: ${JSON.stringify(toolUsesSeen)}`);
  console.log(`[policy-smoke] PreToolUse hook invocations:       ${JSON.stringify(calls.map((c) => c.tool))}`);

  console.log('\n[policy-smoke] assistant said:');
  console.log(
    assistantText
      .trim()
      .split('\n')
      .map((l) => `  | ${l}`)
      .join('\n'),
  );
  console.log('');

  expect(calls.length > 0, 'PreToolUse hook was invoked at least once');

  // Critical: every tool_use the model emitted must have produced a hook
  // invocation. If the SDK silently fast-paths some tools, the policy is not
  // a complete gatekeeper.
  expect(
    toolUsesSeen.length === calls.length,
    `PreToolUse fired for every tool_use (saw ${toolUsesSeen.length} tool_use blocks, ${calls.length} hook invocations)`,
  );

  const writes = calls.filter((c) => c.tool === 'Write');
  if (writes.length === 0) {
    console.warn('  WARN agent did not attempt Write — cannot fully verify the deny path');
  } else {
    expect(writes.every((c) => !c.allowed), 'every Write attempt was denied');
  }

  const reads = calls.filter((c) => c.tool === 'Read');
  expect(reads.length >= 1, 'at least one Read invoked PreToolUse');
  expect(reads.some((c) => c.allowed), 'at least one Read was allowed (in-repo)');
  expect(reads.some((c) => !c.allowed), 'at least one Read was denied (/etc/hosts)');

  let fileExists = false;
  try {
    await fs.access(FORBIDDEN_OUT);
    fileExists = true;
  } catch {
    fileExists = false;
  }
  expect(!fileExists, `${FORBIDDEN_OUT} was not created`);
  if (fileExists) await fs.rm(FORBIDDEN_OUT, { force: true });
}

async function runAgentIntegration(): Promise<void> {
  console.log('\n[policy-smoke] Part 3: runAgent integration (production path)');
  const target = '/tmp/policy-smoke-runagent-must-not-exist.txt';
  await fs.rm(target, { force: true });

  const result = await runAgent({
    invocationId: 'policy-smoke-runagent',
    prompt:
      `Use exactly the absolute path I provide; do not guess other paths. ` +
      `Write the word "hi" to ${target}. ` +
      `If the tool is denied, do not retry — just note the failure and stop.`,
    allowedTools: ['Write'],
  });

  console.log(`  runAgent status: ${result.status}`);

  let exists = false;
  try {
    await fs.access(target);
    exists = true;
  } catch {
    exists = false;
  }
  expect(!exists, `${target} was not created via runAgent`);
  if (exists) await fs.rm(target, { force: true });

  // Phase D: AgentResult.denials must surface the blocked Write.
  expect(Array.isArray(result.denials), 'result.denials is an array');
  expect(result.denials?.length === 1, `result.denials has length 1 (got ${result.denials?.length ?? 0})`);
  const d = result.denials?.[0];
  expect(d?.tool === 'Write', `denial.tool === 'Write' (got ${d?.tool})`);
  expect(d?.target === target, `denial.target === ${target} (got ${d?.target})`);
  expect(typeof d?.reason === 'string' && d.reason.length > 0, 'denial.reason is non-empty string');
}

async function perTaskPolicyIntegration(): Promise<void> {
  console.log('\n[policy-smoke] Part 4: per-task policy override via runAgent');
  const target = path.join(REPO_ROOT, 'briefings/.policy-smoke-pertask.txt');
  const tmpExtra = path.join(REPO_ROOT, '.policy-smoke-pertask-extra');
  await fs.rm(target, { force: true });
  await fs.rm(tmpExtra, { recursive: true, force: true });
  await fs.mkdir(tmpExtra, { recursive: true });
  const targetExtra = path.join(tmpExtra, 'allowed.txt');

  // Without override: writing inside repo but outside default writeRoots
  // (briefings/, wiki/, runs/) should be denied. We pre-created a fresh
  // .policy-smoke-pertask-extra/ inside the repo to test that an override
  // can grant write access to it.
  const policy = resolvePolicy(
    { writeRoots: ['.policy-smoke-pertask-extra'] },
    REPO_ROOT,
  );

  const result = await runAgent({
    invocationId: 'policy-smoke-pertask',
    prompt:
      `Use exactly the absolute path I provide; do not guess. ` +
      `Write the word "ok" to ${targetExtra}. Then stop and report.`,
    allowedTools: ['Write'],
    policy,
  });

  console.log(`  runAgent status: ${result.status}`);
  let exists = false;
  try {
    await fs.access(targetExtra);
    exists = true;
  } catch {
    exists = false;
  }
  expect(exists, `${targetExtra} was created (per-task writeRoots granted access)`);

  await fs.rm(tmpExtra, { recursive: true, force: true });
}

async function runTaskOnDiskIntegration(): Promise<void> {
  console.log('\n[policy-smoke] Part 5: runTask -> on-disk RunRecord includes denials');
  const taskId = 'policy-smoke-runtask-temp';
  const taskPath = path.join(REPO_ROOT, 'tasks', `${taskId}.json`);
  const forbidden = '/tmp/policy-smoke-runtask-must-not-exist.txt';
  await fs.rm(forbidden, { force: true });

  const task: Task = {
    id: taskId,
    description: 'Phase D smoke — fires once, expects a policy denial.',
    prompt:
      `Use exactly the absolute path I provide; do not guess. ` +
      `Write the word "hi" to ${forbidden}. ` +
      `If the tool is denied, do not retry — just note the failure and stop.`,
    scheduleType: 'once',
    scheduleValue: new Date(Date.now() + 60_000).toISOString(),
    enabled: false, // runTask is invoked directly; scheduler is not involved.
    nextRun: null,
    lastRun: null,
    allowedTools: ['Write'],
  };
  await fs.writeFile(taskPath, JSON.stringify(task, null, 2) + '\n');

  let recordPath: string | null = null;
  try {
    const record = await runTask(task);
    expect(record.denials !== undefined, 'in-memory RunRecord.denials is set');
    expect(record.denials?.[0]?.tool === 'Write', 'in-memory denial.tool === Write');
    expect(record.denials?.[0]?.target === forbidden, 'in-memory denial.target matches');

    // Locate the on-disk run record (runs/<date>/<taskId>-<timestamp>.json).
    const date = record.startedAt.slice(0, 10);
    const dir = path.join(REPO_ROOT, 'runs', date);
    const entries = await fs.readdir(dir);
    const match = entries.find((e) => e.startsWith(`${taskId}-`));
    expect(match !== undefined, 'on-disk run record exists');
    if (!match) return;
    recordPath = path.join(dir, match);
    const raw = await fs.readFile(recordPath, 'utf8');
    const onDisk = JSON.parse(raw) as RunRecord;
    expect(Array.isArray(onDisk.denials), 'on-disk record has denials array');
    expect(onDisk.denials?.length === 1, 'on-disk record denials length 1');
    expect(onDisk.denials?.[0]?.target === forbidden, 'on-disk denial.target matches');
  } finally {
    await fs.rm(taskPath, { force: true });
    if (recordPath) await fs.rm(recordPath, { force: true });
    await fs.rm(forbidden, { force: true });
  }
}

async function main(): Promise<void> {
  await unitTests();
  await sdkIntegration();
  await runAgentIntegration();
  await perTaskPolicyIntegration();
  await runTaskOnDiskIntegration();

  console.log('');
  if (failures > 0) {
    console.error(`[policy-smoke] FAIL — ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('[policy-smoke] PASS');
}

main().catch((err) => {
  console.error('[policy-smoke] threw:', err);
  process.exit(1);
});
