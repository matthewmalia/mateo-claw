# Personal Agent — Product Requirements (v1)

> **Historical:** this is the v1 PRD as authored when this repo was a personal instance. Preserved for context — for current setup and operating instructions, see [README.md](README.md).

**Status:** v1 implemented; see `docs/IMPLEMENTATION_PLAN.md` for build log and post-launch fixes.
**Last updated:** 2026-05-08
**Owner:** Matthew
**Companion docs:** `docs/IMPLEMENTATION_PLAN.md`, `README.md`

---

## Problem

Two limits in how I use LLMs today shape what I'm building.

**Conversations are stateless.** Every interaction starts from zero. Context about my ventures, my goals, and my working style has to be re-explained each time. The typical fix — RAG over a document store — retrieves chunks of raw text rather than synthesized knowledge. Nothing accumulates. Nothing compounds.

**Interactions don't have an agent loop.** Chat interfaces take a prompt and return a response. They can't autonomously read files, call tools iteratively, or work through a multi-step task. I'm the orchestration layer today — copy-pasting outputs back as inputs, executing what the model suggests, driving each step myself. The model is a turn-based oracle, not a worker.

The deeper problem behind both is leverage. I'm building toward financial freedom by creating and scaling ventures I own. I want a force multiplier that grows as I do — eventually directing a team of specialist agents that gives one person small-team leverage. That requires a system that learns about me and my work over time, accumulates institutional memory, runs autonomously when given a task, and is fully under my control.

## Goal

Build the v1 of that system. Three capabilities, no more:

1. **Harness — outsourced.**
    - The Claude Agent SDK provides the agent loop, tool execution, and context management. We don't build any of that.
    - We expect to use Claude Code authentication in order to consume tokens from Matthew's Claude Max subscription. We don't pay to use a separate Anthropic API.
2. **Memory — built.** An LLM Wiki (Karpathy pattern) in markdown captures personal context and the agent's generative outputs as durable, interlinked pages.
3. **Identity — minimal.** Two markdown files (`USER.md` and `CLAUDE.md`) give the agent enough context to be useful, and grow over time.

## Success Criteria

The v1 is done when:

- [ ] I can invoke the agent manually (`npm run run-task -- <id>`) and get a useful response
- [ ] The scheduler reliably fires recurring tasks on a cron and writes run records
- [ ] The agent can ingest a new source from `raw/` into structured wiki pages
- [ ] The agent can answer a question by navigating `wiki/index.md` and synthesizing from wiki content
- [ ] The whole system runs as a background service on my Mac across reboots
- [ ] The codebase is small enough that I can read it end-to-end in one sitting (~500 LOC target)

## In Scope

- TypeScript / Node.js implementation built on `@anthropic-ai/claude-agent-sdk`
- File-based persistence (JSON for tasks and runs, markdown for wiki and identity)
- Cron / interval / once scheduling
- Manual task invocation for testing
- macOS launchd deployment for long-running operation
- Karpathy LLM Wiki ingest / query / lint workflows
- Single-process architecture, no microservices

## Out of Scope (v1)

These are deferred. They've been considered and explicitly parked.

- Discord (or any chat-channel) integration
- HTML briefings and notification layer
- HTML/web-based task management layer
- Multi-agent specialist team (chief-of-staff orchestrator + role-specific agents)
- Vector database / semantic retrieval (Qdrant, pgvector, ChromaDB)
- Email as outbound capability
- Container isolation (Docker / Apple Container)
- Identity files beyond `USER.md` and `CLAUDE.md` (no SOUL.md, AGENT.md, HEARTBEAT.md, etc. yet)
- Full Spec Kit `plan.md` / `tasks/` adoption

If a feature isn't in **In Scope**, it's out of scope for v1.

## Key Architectural Decisions

| ID | Decision | Rationale |
|---|---|---|
| ADR-1 | Claude Agent SDK as the harness | Outsources the agent loop, tool execution, context management. Don't reinvent. |
| ADR-2 | Karpathy LLM Wiki for memory | Compounds knowledge as compiled, queryable markdown. No vector store needed at v1 scale. |
| ADR-3 | JSON files for task and run storage | Diffable in Git, editable in any tool. SQLite is overkill at v1 scale. |
| ADR-4 | Sequential task execution | Avoids cost spikes and concurrent CLAUDE.md contention. Implemented via a chained `setTimeout` loop (not `setInterval`, which fires ticks regardless of whether the previous async tick has resolved) plus an in-memory `runningTasks` guard. Trivially upgrades to parallel by widening the guard. |
| ADR-5 | `settingSources: ['project']` for CLAUDE.md auto-loading | Native SDK mechanism; no custom prompt-assembly machinery. |
| ADR-6 | Single Node process, no microservices | Smallest auditable surface area. |
| ADR-7 | Customization via code, not configuration | Borrowed from NanoClaw philosophy. At v1 scale, config schemas cost more than they save. |
| ADR-8 | `PreToolUse` hook for path-scoping policy enforcement | Phase A smoke confirmed `canUseTool` fast-paths in-cwd reads, and `permissionMode: 'dontAsk'` skips it entirely. The `hooks.PreToolUse` layer fires for every `tool_use` block and supports `permissionDecision: 'allow' \| 'deny'`. Single chokepoint, deterministic, mode-independent. |
| ADR-9 | Default write roots: `briefings/`, `wiki/`, `runs/` only | Output zones, not source. Source files (`src/`, `tasks/`, `package.json`, etc.) and identity files (`CLAUDE.md`, `USER.md`) stay author-only. Per-task `policy` overrides are additive, never narrowing — so granting more is explicit, not accidental. |
| ADR-10 | `cwd` locked to `REPO_ROOT`; `Task.cwd` dropped | Per-task `cwd` was a back-door around the entire policy (defaults are computed from the assumed repo root). Single hard-coded `cwd` keeps the policy invariant simple. If a real need surfaces, design against the policy. |

## Functional Requirements

- **FR-1: Manual invocation.** `npm run run-task -- <id>` fires a task immediately, ignoring its schedule.
- **FR-2: Scheduling.** Cron, interval, and once schedule types are supported. Cron uses the system timezone (or `TZ` env override).
- **FR-3: Ingest.** The agent can read a source from `raw/`, produce wiki pages, and update `wiki/index.md` and `wiki/log.md`.
- **FR-4: Query.** The agent can answer a question by navigating `wiki/index.md` and reading relevant pages — without falling back to `raw/` unless explicitly asked.
- **FR-5: Run records.** Every invocation produces a JSON run record in `runs/YYYY-MM-DD/`.
- **FR-6: Identity loading.** `CLAUDE.md` is auto-loaded by the SDK on every invocation; `USER.md` is read by the agent when personal context is needed.
- **FR-7: Background service.** Runs as a long-running process via launchd on macOS.

## Non-Functional Requirements

- **NFR-1: Minimal infrastructure.** Node 20+ and a logged-in Claude Code session — that's it. No API keys, databases, or hosted services. The SDK auto-discovers credentials from `~/.claude/` and consumes tokens from the active Claude Max subscription. Trade-off: portability is bounded to machines where Claude Code is signed in (see Goal §1).
- **NFR-2: Auditability.** Codebase fits in your head. Target ~500 LOC.
- **NFR-3: Privacy.** Secrets in `.env`, never committed, never logged. API requests over HTTPS only.
- **NFR-4: Failure isolation.** A failing task does not crash the scheduler or affect other tasks.
- **NFR-5: Observability.** All invocations leave a run record. Logs go to stdout/stderr (captured by launchd).

## Open Decisions

1. **What goes in the initial `USER.md` and `CLAUDE.md`** — _Partially resolved._ `CLAUDE.md` is in place; `USER.md` is a starter template pending a guided interview with Matthew before real personal context lands.
2. **Repo structure conventions** — _Resolved._ Folder layout shipped in Phase 1; wiki page-type subdirectories (`entities/`, `concepts/`, `syntheses/`, `timelines/`) declared in `CLAUDE.md`. Beyond that, conventions are intentionally emergent per Karpathy's guidance.
3. **First wiki source(s) to ingest** — _Resolved._ `raw/karpathy-llm-wiki.md` ingested in Phase 6, producing `wiki/concepts/karpathy-llm-wiki.md`.
4. **First scheduled task to wire up** — _Resolved._ `tasks/daily-briefing.json` authored, disabled until `USER.md` is filled in.

## Reference Skeleton

The implementation did not start from zero. An example skeleton demonstrating the architecture pattern guided the initial build — `package.json`, `tsconfig.json`, the seven `src/*.ts` files (~441 LOC), `CLAUDE.md` / `USER.md` starter templates, a `tasks/example-task.json`, and a setup README.

The skeleton lived in `/reference/` during the build phase and was removed from the working tree once the implementation diverged. It is preserved under the `archive/reference-skeleton` git tag for posterity; restore with `git checkout archive/reference-skeleton -- reference/`.

## Resources

The repo contains a /resources directory to provide additional details about concepts mentioned here, such as Karpathy memory. Use resources as needed.

- **Do not edit files within the /resources directory.**