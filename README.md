# Personal Agent

A small, auditable template for building your own personal AI agent on top of the Claude Agent SDK. Clone it, fill in two markdown files, and you have an agent that runs scheduled tasks against your Claude Max subscription and keeps a compounding knowledge base for itself.

Three core capabilities, no more:

1. **Harness** — outsourced to `@anthropic-ai/claude-agent-sdk`. The SDK provides the agent loop, tool execution, context management, and built-in tools. We don't build any of that.
2. **Memory** — an LLM Wiki ([Karpathy pattern](resources/karpathy-llm-wiki.md)) in markdown. Lives in `wiki/`, sourced from `raw/`, navigated via `wiki/index.md`.
3. **Identity** — `USER.md` for personal context, `CLAUDE.md` for project schema and operating instructions. The SDK loads `CLAUDE.md` automatically via `settingSources: ['project']`.

For the original v1 spec and build narrative, see [`PRD.md`](PRD.md) and [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Quick Start

1. **Clone & install.** `git clone` this repo, `cd` into it, run `npm install`.
2. **Log into Claude Code** on the same machine if you haven't already (`claude` once, interactively). This project authenticates against your **Claude Max subscription** via the existing Claude Code session — no API key needed. See [Authentication](#authentication).
3. **Verify auth.** `npm run auth-check`. If it prints `OK`, you're set.
4. **Fill in `USER.md`.** Replace the placeholders with real personal context — who you are, what you're working on, how you like to be communicated with. The agent reads this whenever a task needs personal context.
5. **(Optional) Tweak `CLAUDE.md`.** This file is loaded on every agent run as project-level instructions. Adjust the wiki conventions, page types, or operating principles to match how you want the agent to behave.
6. **Try a task.** Copy `tasks/examples/daily-briefing.json` to `tasks/daily-briefing.json`, edit the prompt to taste, and fire it manually: `npm run run-task -- daily-briefing`. The agent writes a briefing to `briefings/<date>.md`. When you're happy, set `enabled: true` and start the scheduler with `npm run dev`.
7. **Deploy as a background service** when you're ready to have it run unattended. See [Long-Running Deployment](#long-running-deployment-macos-launchd).

## Layout

```
personal-agent/
├── package.json
├── tsconfig.json
├── CLAUDE.md            # Project schema — loaded into the agent on every invocation
├── USER.md              # Personal context — agent reads when needed (fill this in)
├── PRD.md               # Original v1 product requirements (historical)
├── docs/
│   └── IMPLEMENTATION_PLAN.md   # Original v1 build plan (historical)
├── resources/           # Reference docs (read-only)
│   └── karpathy-llm-wiki.md
├── src/
│   ├── config.ts        # Constants — paths, defaults, model, timezone
│   ├── types.ts         # Data model — Task, RunRecord, AgentInvocation, AgentResult
│   ├── storage.ts       # JSON file persistence
│   ├── agent.ts         # Wraps SDK's query() with our defaults and result shape
│   ├── policy.ts        # Path-scoping policy gate for tool calls
│   ├── scheduler.ts     # cron / interval / once polling loop
│   ├── index.ts         # Main entry point — starts scheduler, handles SIGINT/SIGTERM
│   └── run-task.ts      # Manual one-shot runner
├── scripts/             # Smoke tests
│   ├── auth-check.ts    # Confirms SDK auto-discovers Claude Code credentials
│   ├── agent-smoke.ts   # End-to-end runAgent() test with the Read tool
│   ├── identity-check.ts # Confirms CLAUDE.md is loaded into agent context
│   └── policy-smoke.ts  # Confirms path-scoping policy gates tool calls
├── deploy/              # macOS launchd plist template + wrapper script
│   ├── com.example.personal-agent.plist.template
│   └── run.sh
├── tasks/               # Active task definitions (one JSON file per task, empty on fresh clone)
│   └── examples/        # Example tasks — copy out into tasks/ to activate
├── runs/                # Run records, organized by date (gitignored)
├── wiki/                # The LLM wiki — index.md + log.md + page-type subdirs
├── raw/                 # Source material you drop in (gitignored)
└── briefings/           # Daily artifacts produced by scheduled tasks (gitignored)
```

## Authentication

This project consumes tokens against your **Claude Max subscription** via the logged-in Claude Code session — no `ANTHROPIC_API_KEY` and no `.env` file. The SDK auto-discovers credentials from `~/.claude/`.

Verify it's working:

```bash
npm run auth-check
```

If that fails ("authentication_failed" or similar), the most likely cause is that the `claude` CLI isn't logged in. Run `claude` once interactively to refresh the session, then re-run the smoke test.

This trades portability for not-paying-twice. The agent only runs on machines where Claude Code is logged in. (PRD NFR-1 has been adjusted accordingly.)

## Setup

```bash
npm install
```

That's it. There's no `.env` to populate.

## Running

```bash
# Local dev (auto-reloads with tsx)
npm run dev

# Production (compile + run)
npm run build
npm start

# Fire a single task immediately, ignoring schedule
npm run run-task -- <task-id>

# Smoke tests — useful as regression checks after SDK upgrades
npm run auth-check        # Auth working?
npm run agent-smoke       # Full pipeline working? (model, tools, stream handler)
npm run identity-check    # CLAUDE.md being loaded?
npm run policy-smoke      # Path-scoping policy gating tool calls?

# Typecheck
npm run typecheck
```

## Authoring Tasks

Fresh clones ship with an empty `tasks/` directory and two starting points under `tasks/examples/`:

- `tasks/examples/daily-briefing.json` — a cron-scheduled morning briefing.
- `tasks/examples/example-ingest.json` — a once-task that walks the wiki ingest workflow on a file in `raw/`.

Copy either into `tasks/` to activate it (the scheduler only reads `tasks/*.json` at the root, not subdirectories). Then edit the prompt, set `enabled: true`, and either fire it manually with `npm run run-task -- <task-id>` or let `npm run dev` pick it up.

To author a task from scratch, drop a JSON file in `tasks/` matching the `Task` interface in [`src/types.ts`](src/types.ts). Minimum fields:

```json
{
  "id": "kebab-case-id",
  "description": "Human-readable.",
  "prompt": "What you want the agent to do when this task fires.",
  "scheduleType": "cron | interval | once",
  "scheduleValue": "...",
  "enabled": true,
  "nextRun": null,
  "lastRun": null,
  "allowedTools": ["Read", "Write", "Edit", "Glob"]
}
```

- `scheduleValue`:
    - `cron` — a cron expression, e.g. `"0 7 * * 1-5"` (timezone via `TZ` env var or `TIMEZONE` in `config.ts`, default `America/New_York`)
    - `interval` — milliseconds as a string, e.g. `"3600000"` (1h). Must be ≥ `MIN_INTERVAL_MS` (5 min default).
    - `once` — an ISO timestamp; the task auto-disables after running once.
- `nextRun: null` is fine — the scheduler will compute it on first sight.
- `allowedTools` restricts the agent's available toolset. Omit for the default set in `config.ts`.
- Optional: `model`, `policy` (see "Task Policy" below). The agent's `cwd` is locked to the repo root.

### Task Policy

Every tool call is gated by a path-scoping policy enforced via the SDK's `PreToolUse` hook (see `src/policy.ts`, `scripts/policy-smoke.ts`). Defaults from `defaultPolicy()`:

- **Read** anywhere in the repo.
- **Write / Edit** only inside `briefings/`, `wiki/`, `runs/`.
- **Bash** denied. **WebFetch / WebSearch** allowed.
- Unknown tools fail closed.

Most tasks need nothing extra — defaults already cover ingest, briefing, and query workflows. A task can extend the policy via an optional `policy` field (paths relative to repo root):

```json
{
  "id": "ingest-newsletter",
  "policy": {
    "readRoots": ["/Users/<you>/Downloads/newsletter-archive"],
    "writeRoots": ["wiki/concepts"],
    "allowBash": false,
    "allowWeb": true
  }
}
```

Resolution rules:
- `readRoots` and `writeRoots` are **additive** — per-task entries are added to defaults; you cannot narrow defaults from a task. To narrow, edit `defaultPolicy` in `src/policy.ts`.
- `allowBash` and `allowWeb` override defaults outright.
- Malformed `policy` shapes are rejected at task load (`validateTaskPolicy`) — fail loud, not silent.

Every denial is logged as `[policy] denied <tool> for <task-id>: <reason>`, and the agent receives the reason as a tool error so it can recover gracefully.

## How the Wiki Works

The wiki is the agent's compiled knowledge base. New material lands in `raw/`; the agent ingests it into synthesized markdown pages under `wiki/`, navigable via `wiki/index.md`. See [`CLAUDE.md`](CLAUDE.md) for the workflow conventions and [`resources/karpathy-llm-wiki.md`](resources/karpathy-llm-wiki.md) for the canonical pattern.

To validate the workflow end-to-end, this repo already has one source ingested: `raw/karpathy-llm-wiki.md` → `wiki/concepts/karpathy-llm-wiki.md`.

## Long-Running Deployment (macOS launchd)

A `launchd` plist template lives at [`deploy/com.example.personal-agent.plist.template`](deploy/com.example.personal-agent.plist.template), with a wrapper script at [`deploy/run.sh`](deploy/run.sh) that sources `nvm` so the agent survives Node version upgrades.

The plist:
- Runs the agent as your logged-in user (LaunchAgent, not LaunchDaemon).
- Restarts only on non-zero exit (`KeepAlive: SuccessfulExit=false`), with a 60s `ThrottleInterval` to prevent crash loops.
- Writes stdout/stderr to `~/Library/Logs/personal-agent.{out,err}.log`.
- Sets a sane `PATH` and `TZ` for child processes; everything else inherits from the user session.

The template contains two placeholders — `__REPO_ROOT__` and `__HOME__` — that you substitute when rendering the real plist. The rendered file is gitignored so each machine gets its own.

### Install

```bash
# 1. Build production output
npm run build

# 2. Render the plist from the template (substitute your repo path + $HOME)
sed -e "s|__REPO_ROOT__|$(pwd)|g" -e "s|__HOME__|$HOME|g" \
  deploy/com.example.personal-agent.plist.template \
  > deploy/com.example.personal-agent.plist

# 3. (Optional) Edit deploy/com.example.personal-agent.plist if you want a
#    different Label (e.g. com.<yourname>.personal-agent) or TZ.

# 4. Symlink into ~/Library/LaunchAgents/
ln -s "$(pwd)/deploy/com.example.personal-agent.plist" ~/Library/LaunchAgents/

# 5. Bootstrap (modern launchctl, macOS 10.10+)
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.example.personal-agent.plist

# Tail logs to confirm it's running
tail -f ~/Library/Logs/personal-agent.out.log
```

### Stop / restart

```bash
# Stop (and unload across reboots)
launchctl bootout "gui/$(id -u)/com.example.personal-agent"

# Bounce after editing the plist (re-render first if the template changed)
launchctl bootout "gui/$(id -u)/com.example.personal-agent" \
  && launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.example.personal-agent.plist
```

If you changed the `Label` in step 3, substitute it for `com.example.personal-agent` in the commands above.

Before installing, run the agent in foreground for a day (`npm start`) to catch any crashes or auth-loss patterns under your real schedule. If launchd reports an error, the most likely culprits are: stale `dist/` (re-run `npm run build`), missing Claude Code session (`claude` interactively to re-auth), or an unsubstituted placeholder in the rendered plist (re-run the `sed` step above).

### Other platforms

- **Linux**: a `systemd --user` service. Same wrapper script idea applies.
- **Windows**: Task Scheduler with "Run whether user is logged on or not."

Note: because we use Claude Code session auth, the agent only runs on the machine where you've logged in via the `claude` CLI.

## Philosophy

Borrowed from NanoClaw: customization equals code changes, not configuration sprawl. Want different behavior? Edit `config.ts`, `agent.ts`, or the relevant module. The whole codebase is small enough that this is safe.

## SDK Version Note

This project was built against `@anthropic-ai/claude-agent-sdk@0.2.129`. The SDK is pre-1.0 (0.2.x) and message-stream field shapes can drift between versions. If smoke tests fail after an upgrade, the most likely culprits are in `src/agent.ts`:

- The `type: 'assistant'` message shape and content-block extraction
- The `type: 'result'` message's `subtype`/`is_error`/`result` fields

Verify against the latest SDK type declarations and adjust.

References:
- https://platform.claude.com/docs/en/agent-sdk/overview
- https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk

## Credits / Origin

Built by [@matthewmalia](https://github.com/matthewmalia) as v1 of a personal agent harness, then generalized into a template. [`PRD.md`](PRD.md) and [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) preserve the original build narrative — including the two reference-skeleton bugs found, the scheduler concurrency runaway, and the path-scoping policy migration — for anyone curious about how this got from zero to working.
