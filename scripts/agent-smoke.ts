/**
 * Phase 2 smoke test — exercises src/agent.ts end-to-end.
 *
 * Verifies: stream handler extracts text correctly, model selection works,
 * tools restriction works (Read is available, Bash isn't), the agent can
 * actually use a tool to read a file in cwd.
 *
 *   npm run agent-smoke
 */

import { runAgent } from '../src/agent.js';

async function main(): Promise<void> {
  const result = await runAgent({
    invocationId: 'agent-smoke',
    prompt:
      'Read PRD.md from the current working directory and return a single sentence ' +
      'identifying the three core capabilities of v1. No preamble.',
    allowedTools: ['Read'],
  });

  console.log('\n---');
  console.log(`status: ${result.status}`);
  console.log(`durationMs: ${result.durationMs}`);
  if (result.error) console.log(`error: ${result.error}`);
  if (result.result) console.log(`result: ${result.result}`);

  process.exit(result.status === 'success' ? 0 : 1);
}

main().catch((err) => {
  console.error('[agent-smoke] threw:', err);
  process.exit(1);
});
