# Karpathy LLM Wiki Pattern

The LLM Wiki pattern is a knowledge compilation architecture where the agent transforms raw source materials into an organized, interlinked wiki that becomes the persistent knowledge base, rather than repeatedly retrieving fragments from the original sources.

## Core Idea

Karpathy's metaphor: the wiki is source code, raw materials are input, and the LLM is the compiler. Over time, the wiki becomes the canonical place to find synthesized knowledge instead of re-reading originals.

## Three-Layer Architecture

**Raw layer (`raw/`)**: Immutable storage for incoming sources—articles, transcripts, notes, papers. The agent only reads here, never writes. New materials land in this layer and trigger ingestion workflows.

**Wiki layer (`wiki/`)**: A directory of markdown pages organized by type—entities, concepts, syntheses, timelines. The agent owns this layer completely: creating pages on ingest, updating them when sources contradict or extend prior claims, and maintaining cross-references between related pages.

**Configuration layer (`CLAUDE.md`)**: The project's schema file defining conventions, page types, naming rules, and workflow expectations. This is where behavior gets tuned without touching code.

## Two Anchor Files

Within the wiki, two files play privileged roles:

**`index.md`**: A table of contents listing every wiki page by category, with links and summaries. The agent consults this first when answering questions—it's the navigation surface that keeps the wiki queryable without embeddings.

**`log.md`**: An append-only chronological record of all wiki changes (ingests, updates, lints). Entries follow a consistent format so the agent can track recent work and understand what's been changed.

## Three Core Workflows

**Ingest**: A new source arrives in `raw/`. The agent reads it, identifies entities and concepts, creates or updates relevant wiki pages, checks for contradictions with existing knowledge, and appends a summary to the log.

**Query**: When a question is asked, the agent starts at `index.md` to find relevant pages, drills into them, and synthesizes an answer. Only if the wiki lacks information does it fall back to original sources.

**Lint**: Periodic maintenance. The agent scans the wiki for contradictions between pages, orphaned entries, broken cross-references, and stale claims. Lint identifies problems; fixing them is a separate step.

## Why This Beats Naive RAG

Standard retrieval-augmented generation re-fetches and re-summarizes the same chunks on every query, accumulating no learning. The wiki pattern compiles knowledge once and keeps it current, so subsequent queries benefit from synthesis done across all previous interactions. The model pays a small bookkeeping cost upfront but gains faster queries and the ability to spot contradictions over time.

At large scale, RAG and the wiki pattern can coexist: the wiki may sit on top of a retrieval substrate (vector search, BM25) when needed.

## Scale Considerations

Karpathy operates his own wiki at roughly 100 articles and 400,000 words. At that scale, the index fits in a context window and simple catalog-based navigation is fast. Beyond several thousand pages, a retrieval substrate becomes necessary to keep queries efficient. Until then, directory-style indexing works well. For this project's initial phase, scale is not a constraint.

---

[raw](../../raw/karpathy-llm-wiki.md)
