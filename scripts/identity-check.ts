/**
 * Phase 4 verification — confirms CLAUDE.md is auto-loaded into the agent's
 * context via settingSources: ['project']. Asks a question only answerable
 * from CLAUDE.md content.
 */

import { runAgent } from '../src/agent.js';

async function main(): Promise<void> {
  const result = await runAgent({
    invocationId: 'identity-check',
    prompt:
      'Without using any tools, in one sentence: what is the role of wiki/index.md ' +
      'according to your project instructions?',
    allowedTools: [],
  });

  console.log('\n---');
  console.log(`status: ${result.status}`);
  if (result.error) console.log(`error: ${result.error}`);
  if (result.result) console.log(`result: ${result.result}`);

  process.exit(result.status === 'success' ? 0 : 1);
}

main().catch((err) => {
  console.error('[identity-check] threw:', err);
  process.exit(1);
});
