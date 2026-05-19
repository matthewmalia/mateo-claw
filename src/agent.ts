/**
 * Agent invocation layer. Wraps the Claude Agent SDK's `query()` function
 * with our defaults and our result shape. A single chokepoint for all
 * agent calls — scheduled tasks and manual one-shots both flow through here.
 *
 * Auth: the SDK auto-discovers credentials from the logged-in Claude Code
 * session (~/.claude/). No env vars or .env file. Confirmed via
 * scripts/auth-check.ts in Phase 0.
 *
 * Stream handling note: SDK 0.2.x emits assistant text as content blocks
 * inside `type: 'assistant'` messages — not as a top-level `type: 'text'`.
 * The result message carries the final-turn text on success.
 *
 * Policy: every tool call is gated by checkToolUse() via the PreToolUse
 * hook. Phase A smoke confirmed this hook fires for every tool_use block,
 * unlike canUseTool which fast-paths in-cwd reads. See src/policy.ts.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { HookInput, PreToolUseHookSpecificOutput } from '@anthropic-ai/claude-agent-sdk';
import {
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_MODEL,
  REPO_ROOT,
} from './config.js';
import { defaultPolicy, checkToolUse, extractTarget } from './policy.js';
import type { AgentInvocation, AgentResult, PolicyDenial } from './types.js';

export async function runAgent(input: AgentInvocation): Promise<AgentResult> {
  const startTime = Date.now();
  const cwd = REPO_ROOT;
  const tools = input.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  const model = input.model ?? DEFAULT_MODEL;
  const policy = input.policy ?? defaultPolicy(REPO_ROOT);

  console.log(`[agent] starting: ${input.invocationId} (model=${model})`);

  let assistantText = '';
  let finalResult: string | undefined;
  let resultError: string | undefined;
  const denials: PolicyDenial[] = [];

  // PreToolUse hook — the single gate for every tool call. Returns 'allow'
  // or 'deny' based on checkToolUse(). Denials are logged loudly here AND
  // captured into `denials` for inclusion in the run record.
  const policyHook = async (hookInput: HookInput) => {
    if (hookInput.hook_event_name !== 'PreToolUse') {
      return { continue: true };
    }
    const decision = await checkToolUse(
      hookInput.tool_name,
      (hookInput.tool_input ?? {}) as Record<string, unknown>,
      policy,
      cwd,
    );
    if (!decision.allowed) {
      denials.push({
        tool: hookInput.tool_name,
        reason: decision.reason,
        target: extractTarget(hookInput.tool_name, hookInput.tool_input),
      });
      console.warn(
        `[policy] denied ${hookInput.tool_name} for ${input.invocationId}: ${decision.reason}`,
      );
    }
    const out: PreToolUseHookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.allowed ? 'allow' : 'deny',
      permissionDecisionReason: decision.allowed ? undefined : decision.reason,
    };
    return { hookSpecificOutput: out };
  };

  try {
    const stream = query({
      prompt: input.prompt,
      options: {
        cwd,
        model,
        // Defense in depth: `tools` restricts which built-in tools are
        // available; the PreToolUse hook below is the per-call path-scope
        // gate. Phase E2 probe confirmed hooks fire under permissionMode:
        // 'default' with no allowDangerouslySkipPermissions — the hook's
        // permissionDecision is what the SDK is waiting for.
        tools,
        permissionMode: 'default',
        // settingSources: ['project'] tells the SDK to load CLAUDE.md from cwd.
        // USER.md is read by the agent on demand via the Read tool when
        // CLAUDE.md tells it to.
        settingSources: ['project'],
        hooks: {
          PreToolUse: [{ hooks: [policyHook] }],
        },
      },
    });

    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        const blocks = (msg.message as { content?: Array<{ type: string; text?: string }> })
          .content ?? [];
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            assistantText += block.text;
            process.stdout.write(block.text);
          }
        }
      }

      if (msg.type === 'result') {
        const r = msg as {
          subtype: string;
          is_error: boolean;
          result?: string;
          errors?: string[];
        };
        if (r.is_error) {
          resultError = `${r.subtype}: ${(r.errors ?? []).join('; ') || 'unknown error'}`;
        } else {
          finalResult = r.result;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const denialsField = denials.length > 0 ? denials : undefined;

    if (resultError) {
      console.error(`\n[agent] failed: ${input.invocationId}: ${resultError}`);
      return { status: 'error', error: resultError, durationMs, denials: denialsField };
    }

    console.log(
      `\n[agent] completed: ${input.invocationId} (${durationMs}ms${
        denials.length > 0 ? `, ${denials.length} policy denial(s)` : ''
      })`,
    );
    return {
      status: 'success',
      result: finalResult ?? assistantText,
      durationMs,
      denials: denialsField,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] threw: ${input.invocationId}: ${message}`);
    return {
      status: 'error',
      error: message,
      durationMs,
      denials: denials.length > 0 ? denials : undefined,
    };
  }
}
