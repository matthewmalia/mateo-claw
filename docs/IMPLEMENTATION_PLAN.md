# Implementation Plan

> **Historical:** this is the v1 build plan as authored when this repo was a personal instance. Preserved for context — for current setup and operating instructions, see [README.md](../README.md). Filenames referenced below (e.g. `com.mmalia.personal-agent.plist`) reflect their original names at build time; the live template equivalents are documented in the README.

**Status:** Phases 0–8 complete. v1 spec satisfied; install the launchd plist when ready. Two post-launch changes shipped: scheduler concurrency fix (2026-05-08) and path-scoping policy (2026-05-18).
**Last updated:** 2026-05-18
**Companion docs:** [`PRD.md`](../PRD.md), [`README.md`](../README.md)

## How This Plan Was Executed

The PRD set the spec; an example skeleton (preserved under the `archive/reference-skeleton` git tag) suggested an architecture. We didn't copy the skeleton verbatim — we read it carefully, found two real bugs (broken stream handler, broken once-task scheduling), and resolved a contradiction in the PRD (PRD §1 said "Claude Max auth" but NFR-1 implied API keys). Each phase shipped working, tested code before moving on.

## Key Decisions Resolved

| ID | Decision | Outcome |
|---|---|---|
| Auth path | API key vs. Claude Max via Claude Code session | Claude Max (B1 — SDK auto-discovers from `~/.claude/`). Confirmed via `scripts/auth-check.ts`. PRD NFR-1 updated to acknowledge loss of portability. |
| Cost / budget | Track `total_cost_usd`? Cap with `maxBudgetUsd`? | Removed entirely from v1. We'll revisit when there's a validated agent loop and we can decide between dollar-tracking (API key world) vs. token-quota tracking (Max world). |
| Default model | Cheap or capable? | `claude-haiku-4-5-20251001` for the validation phase. Tasks override via the `model` field on `Task`. |
| Permission mode | `acceptEdits` vs. `bypassPermissions` vs. `default` + hooks | Originally `bypassPermissions` + `allowDangerouslySkipPermissions: true`; replaced in 2026-05-18 by `permissionMode: 'default'` + a `PreToolUse` hook (the actual gate — see ADR-8). Tool restriction is the SDK's `tools` option, not `allowedTools`. |
| Rate-limit guard | Daily token budget? Interval floor? | Interval floor only (`MIN_INTERVAL_MS = 5 min`). Daily token guard deferred until we have token-tracking. |
| Wiki briefings | Page type or operational output? | Operational output — `briefings/` at the repo root, gitignored. Keeps `wiki/` for synthesized knowledge only. |

## Phases

### Phase 0 — Foundation ✅
- `package.json`, `tsconfig.json`, `.gitignore`
- Top-level dirs (`src/`, `scripts/`, `tasks/`, `wiki/`, `raw/`, `runs/`, `docs/`)
- `npm install` → `@anthropic-ai/claude-agent-sdk@0.2.129`
- `scripts/auth-check.ts` smoke test confirmed B1 auto-discovery works.

### Phase 1 — Data + storage ✅
- `src/types.ts`, `src/config.ts`, `src/storage.ts`
- Diff from reference: dropped `costUsd`/`maxBudgetUsd`/`tags`; added `model` to `Task` and `AgentInvocation`; added `prompt` and `model` to `RunRecord` for audit/replay; added `MIN_INTERVAL_MS` and `DEFAULT_MODEL` to config; added `Grep` to default tools.

### Phase 2 — Agent wrapper ✅
- `src/agent.ts` — wraps `query()` with our defaults and result shape.
- **Fixed reference bug**: stream handler updated for SDK 0.2.x. The reference checks `m.type === 'text'` which never matches; the SDK emits `type: 'assistant'` with text inside `message.content[]` content blocks.
- Pass tools as the SDK's `tools` option (restricts availability) rather than `allowedTools` (auto-approve, no-op under bypassPermissions).
- Properly distinguish `SDKResultSuccess` and `SDKResultError` from the result message.
- `scripts/agent-smoke.ts` confirmed end-to-end with the Read tool against `PRD.md`.

### Phase 3 — Scheduler + entrypoints ✅
- `src/scheduler.ts`, `src/index.ts`, `src/run-task.ts`
- **Fixed reference bug**: once-task scheduling. Reference returned `null` from `computeNextRun` for once-tasks, which made future-scheduled once-tasks unfireable. Now `computeNextRun` returns the parsed `scheduleValue`; terminal-state handling moved into `runTask` post-processing.
- Lazy `nextRun` bootstrap via `ensureNextRun` — fresh tasks with `nextRun: null` get computed on first sight.
- `MIN_INTERVAL_MS` floor enforced inside `computeNextRun`.
- Bad-schedule handling: failures during post-run nextRun computation log + clear `nextRun` (task stops firing until fixed; loop keeps running).
- cron-parser null guard (`CronDate.toISOString()` returns `string | null`).
- End-to-end test with a once-task confirmed: run record written, task auto-disabled, scheduler starts/stops cleanly.

### Phase 4 — Identity files ✅
- `CLAUDE.md` — adapted from reference (added `Grep`, added `resources/` to layout, added `timelines` as a fourth wiki page type).
- `USER.md` — starter template with placeholder sections.
- `scripts/identity-check.ts` confirmed `settingSources: ['project']` actually surfaces `CLAUDE.md` to the model.

### Phase 5 — Wiki bootstrap ✅
- `wiki/index.md` — catalog with the four declared page types.
- `wiki/log.md` — empty changelog.
- Deliberately no pre-created subdirectories — Write auto-creates parents on first page write, and premature schemas are worse than no schemas.

### Phase 6 — First task + workflow validation ✅
- Seeded `raw/karpathy-llm-wiki.md` (copy of the resources/ reference).
- Ingest validation: synthesized → `wiki/concepts/karpathy-llm-wiki.md`, updated index/log. **FR-3 confirmed.**
- Query validation: agent navigated index → page and answered correctly. **FR-4 confirmed.**
- `tasks/daily-briefing.json` authored, `enabled: false`. Resolves PRD Open Decision #4.
- `briefings/` added to `.gitignore`.

### Phase 7 — Documentation ✅
- This file.
- `README.md`.

### Phase 8 — Background service ✅
- `deploy/com.mmalia.personal-agent.plist` — LaunchAgent (runs as logged-in user; no `UserName` key needed for LaunchAgents).
- `deploy/run.sh` — wrapper that sources `nvm` so node version upgrades don't require editing the plist. Exec-replaces itself with the node process.
- `KeepAlive: { SuccessfulExit: false }` + `ThrottleInterval: 60` — restart only on crashes, with throttling.
- Logs to `~/Library/Logs/personal-agent.{out,err}.log`.
- README documents `launchctl bootstrap`/`bootout` commands.
- **Not yet installed** — recommend running in foreground for a day before bootstrapping.

## Post-launch fixes

### 2026-05-08 — Scheduler concurrency runaway

**Symptom.** A single Sonnet test task with a past `scheduleValue` was picked up and started 8 separate concurrent times, exactly 30 seconds apart, before any of the runs could write back `enabled: false`. Burned ~8× the intended Claude Max quota and produced repeated overwrites of the same briefing file.

**Root cause.** Two layered bugs in `scheduler.ts`:
1. `setInterval(tick, 30_000)` fires its callback every 30s regardless of whether the previous async `tick()` has resolved. ADR-4 says "sequential task execution," but the implementation didn't enforce it across ticks.
2. Each tick reads task state from disk fresh. Until a tick finishes and persists the post-run state, subsequent ticks see the same task as still-due.

**Fix.** Two layers in `src/scheduler.ts`:
1. Replaced `setInterval` with a recursive `setTimeout` loop — the next tick is scheduled only after the previous one resolves. A long task simply pushes the next tick later.
2. Added an in-memory `runningTasks: Set<string>` guard. The tick filter excludes tasks already in the set; `runTask` is wrapped with `add` / `finally delete`. Defensive backup in case the loop ordering ever drifts.

ADR-4 in the PRD updated to call out the chained-setTimeout-plus-running-set implementation explicitly.

### 2026-05-18 — Path-scoping policy

**Symptom.** Adversarial review (2026-05-09) found the agent ran with `bypassPermissions` + `allowDangerouslySkipPermissions: true`, gated only by the `tools` allowlist. With `Write` / `Edit` in the default toolset and `cwd` overridable per task, a hostile or accidental prompt could overwrite `src/`, `tasks/`, `deploy/`, or anything under `~/`. Web-fetched content already flowed into run records, opening a prompt-injection vector.

**Fix (PR #1, 5 phases A–E).**
1. New `src/policy.ts` — `TaskPolicy`, `defaultPolicy`, `resolvePolicy`, `validateTaskPolicy`, `checkToolUse` with realpath + symlink-resolved prefix checks; unknown tools fail closed.
2. Enforcement via SDK `hooks.PreToolUse` (Phase A smoke confirmed `canUseTool` fast-paths in-cwd reads — see ADR-8).
3. Per-task `policy` override on `Task` JSON — additive on roots, override on booleans, validated at load.
4. Denials captured in `RunRecord.denials` (slim `{ tool, reason, target }`).
5. Dropped `Task.cwd` (ADR-10) and `allowDangerouslySkipPermissions` (Phase E2 probe confirmed hooks fire under `permissionMode: 'default'`). PRD picked up ADR-8/9/10.

Smoke harness `scripts/policy-smoke.ts` covers 5 integration parts (50+ assertions): unit, direct `query()`, `runAgent` deny path, per-task override allow path, and `runTask` → on-disk `RunRecord` round-trip.

## Pending Open Decisions from the PRD

- **#1 — initial USER.md content**: starter template only. Real interview when ready.
- **#2 — wiki naming conventions beyond the four page types**: emergent. Karpathy's gist is intentionally sparse; let conventions land via use.

## v1 Success Criteria Status

- [x] `npm run run-task -- <id>` works
- [x] Scheduler reliably fires recurring tasks
- [x] Agent ingests sources from `raw/` into structured wiki pages
- [x] Agent answers questions by navigating `wiki/index.md`
- [x] Background service via launchd — plist authored, ready to install
- [x] ~500 LOC target — comfortably within budget

## Failure Mode Notes (D2 fallback)

If the SDK loses auth mid-run:
1. The `result` message will have `subtype: 'error_during_execution'` (or similar) and the run record captures `status: 'error'` with the SDK error in `error`.
2. The scheduler logs the failure but keeps polling — other tasks continue firing.
3. Re-auth by running `claude` interactively. The next scheduled tick picks up the refreshed session.

If `~/.claude/` auto-discovery breaks (B1 fails) but you still have a session token:
1. Read the token from `~/.claude/`.
2. Pass it via `ANTHROPIC_AUTH_TOKEN` env var (B2 fallback).
3. For launchd, set it in the plist's `EnvironmentVariables`.
