# Karpathy LLM Wiki Pattern

**Source:** Andrej Karpathy, "LLM Wiki" — <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
**Published:** April 4, 2026
**This file:** Paraphrased reference for use in this project. Read the canonical gist for the source of truth.

## Why This File Exists

The PRD and Implementation Plan reference "the Karpathy pattern" as the memory model. This file makes that reference concrete — what the pattern actually prescribes, what's our adaptation, and when to consult Karpathy's original gist directly.

This is a paraphrase, not a copy. Karpathy's gist is intentionally short and abstract — designed to be copy-pasted to an LLM agent which then collaborates with the user to build the specifics. If implementation questions arise that this file doesn't answer, read the gist.

## The Pattern in One Sentence

The LLM is a compiler. Raw sources are source code. The wiki is the compiled output — interlinked markdown pages the LLM maintains as new sources arrive.

Karpathy's mental model from the gist: **Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase.**

## Three-Layer Architecture

The pattern has three layers, with strict separation between them.

**1. Raw sources (`raw/`).** An immutable folder of articles, papers, transcripts, notes, conversations. The LLM only ever reads from here. Never writes. New sources land here and get ingested.

**2. The wiki (`wiki/`).** A directory of LLM-generated markdown files. Summaries, entity pages, concept pages, syntheses. The LLM owns this layer entirely — it creates pages on ingest, updates them when new sources contradict or extend old claims, maintains cross-references via markdown links.

**3. The schema (`CLAUDE.md`).** A configuration file that tells the agent the conventions, page types, naming rules, and workflow expectations. This is where the project's instantiation of the pattern lives. Editing CLAUDE.md is how you change the agent's behavior without writing code.

## Two Anchor Files

Inside the wiki, two files have privileged roles.

**`index.md` — the catalog.** Every wiki page is listed here, organized by category, with a link, a one-line summary, and optionally light metadata. The agent reads this first when answering a query — it's the navigation surface that lets the wiki scale without embeddings.

**`log.md` — the chronological record.** Append-only timeline of changes. Entries follow a consistent prefix format (e.g. `## [YYYY-MM-DD] ingest | Source Title`) which keeps them parseable with simple text tools. The log gives the agent a way to know what's been done recently.

## Three Workflows

**Ingest.** A new source arrives in `raw/`. The agent reads it, identifies entities and concepts, creates or updates wiki pages, strengthens or revises cross-references, flags contradictions with prior pages, appends to `log.md`. A single ingest typically touches many pages — that's the point.

**Query.** A question is asked. The agent reads `index.md` first to find relevant pages, drills into them, and synthesizes an answer from what's there. The query path does not go back to `raw/` unless the wiki is incomplete.

**Lint.** Periodic maintenance. Find contradictions between pages, orphans not linked from `index.md`, broken internal links, claims that have gone stale based on dates. Lint is read-only — it reports findings; fixing is a separate step.

## Why This Beats Naive RAG

Standard RAG retrieves chunks of raw text on every query. The model rediscovers the same facts from the same chunks, every time. Nothing accumulates.

The wiki pattern compiles knowledge once and keeps it current. The next question benefits from all the synthesis work done for every previous question. The tedious part of maintaining a knowledge base isn't the reading or the thinking — it's the bookkeeping. The LLM is now good enough at bookkeeping to make the pattern practical.

This isn't a claim that RAG is obsolete — RAG and the wiki pattern solve different problems. RAG is stateless retrieval over many documents. The wiki is stateful synthesis over time. They can coexist; the wiki may live on top of a RAG layer when scale demands it.

## Scale Considerations

Karpathy reports running his own wiki at roughly 100 articles and ~400,000 words. At that scale, the index file fits in a context window and navigation by index is essentially a directory listing. Beyond that scale, a real retrieval substrate (BM25, vector search, or hybrid) becomes necessary — at which point the wiki pattern is built on top of, not instead of, traditional RAG infrastructure.

For our v1, we're well within "moderate scale works without embeddings" territory. When the wiki starts feeling unwieldy, that's the signal to revisit retrieval architecture.

## What's Canonical vs. Our Adaptation

Karpathy's gist is intentionally sparse. He describes the pattern at the level of philosophy and structure, not implementation.

**Canonical (from the gist):**
- The three-layer architecture (raw / wiki / schema)
- Index-first navigation
- `index.md` and `log.md` as anchor files
- The ingest / query / lint workflows
- The "compile, don't retrieve" mental model
- Filing good answers back as new wiki pages
- Moderate-scale operation without embeddings

**Our adaptation (this project's conventions, see `CLAUDE.md`):**
- Specific page-type subdirectories: `entities/`, `concepts/`, `syntheses/`, `timelines/`
- Kebab-case filenames for wiki pages
- Specific log entry format with date prefix
- Sequential agent invocation (one task at a time)
- File-based task and run records (no SQLite)

When in doubt about whether something is prescribed or our choice, default to the gist. Our adaptations are conveniences, not requirements.

## When to Consult the Original

Read the gist directly when:

- Adding a new wiki convention — check whether Karpathy addresses it before inventing a new pattern.
- The wiki starts feeling unwieldy — the gist has the original mental model that helped frame the trade-offs.
- Considering whether to add embeddings, BM25, or hybrid retrieval — Karpathy's scale guidance is the right starting point.
- Working with someone else who's familiar with the pattern but not our adaptations — establish shared canonical language first.

The gist is short (under 15 minutes to read). When in doubt, just read it.
