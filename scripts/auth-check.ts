/**
 * Auth verification — Phase 0 smoke test.
 *
 * Goal: confirm the Claude Agent SDK can acquire credentials via Claude
 * Code's logged-in session ("B1" path) without us setting any auth env vars.
 *
 * Run with no env setup:
 *   npm run auth-check
 *
 * If this prints `OK` and a result, B1 works and we can rely on auto-discovery.
 * If it prints an auth error, we need the B2 fallback (read ~/.claude/ token
 * ourselves and pass via env) when we wire up agent.ts in Phase 3.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

const MODEL = 'claude-haiku-4-5-20251001';

async function main(): Promise<void> {
  console.log('[auth-check] starting');
  console.log('[auth-check]  ANTHROPIC_API_KEY     set?', Boolean(process.env.ANTHROPIC_API_KEY));
  console.log('[auth-check]  ANTHROPIC_AUTH_TOKEN  set?', Boolean(process.env.ANTHROPIC_AUTH_TOKEN));
  console.log(`[auth-check]  model: ${MODEL}`);

  const stream = query({
    prompt: 'Reply with the single word: pong',
    options: {
      model: MODEL,
      tools: [],
      settingSources: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    },
  });

  let assistantText = '';
  let resultPayload: unknown = null;

  for await (const msg of stream) {
    if (msg.type === 'assistant') {
      if (msg.error) {
        console.error(`[auth-check] assistant error: ${msg.error}`);
      }
      const blocks = (msg.message as { content?: Array<{ type: string; text?: string }> })
        .content ?? [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text) assistantText += block.text;
      }
    }
    if (msg.type === 'result') {
      resultPayload = msg;
    }
  }

  console.log('\n[auth-check] assistant text:', assistantText.trim() || '(none)');

  if (!resultPayload) {
    console.error('[auth-check] FAIL — stream ended without a result message');
    process.exit(1);
  }

  const r = resultPayload as {
    subtype: string;
    is_error: boolean;
    result?: string;
    errors?: string[];
    total_cost_usd?: number;
    usage?: unknown;
  };

  if (r.is_error) {
    console.error(`[auth-check] FAIL — result subtype=${r.subtype}`);
    console.error('[auth-check] errors:', r.errors);
    console.error('[auth-check] B1 (auto-discovery) did not work. Implement B2 in Phase 3.');
    process.exit(1);
  }

  console.log('[auth-check] OK — SDK acquired credentials via Claude Code session');
  console.log(`[auth-check]   subtype=${r.subtype}`);
  console.log(`[auth-check]   total_cost_usd=${r.total_cost_usd}`);
  console.log(`[auth-check]   result preview=${(r.result ?? '').slice(0, 100)}`);
}

main().catch((err) => {
  console.error('[auth-check] threw:', err);
  process.exit(1);
});
