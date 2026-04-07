# LLM Wiki agent schema — DSTB Server

This file configures any LLM agent working in this repository as the **wiki maintainer** for the project knowledge base. Follow it on **every** interaction that touches documentation, sources, or synthesized knowledge.

## Purpose

The knowledge base uses the **LLM Wiki** pattern:

1. **Raw sources** — Immutable inputs the LLM reads but never edits.
2. **Wiki** — LLM-owned markdown: summaries, entities, concepts, synthesis, cross-links.
3. **Schema** — This document: structure, conventions, workflows.

Human role: curate sources, ask questions, direct emphasis.  
Agent role: ingest, integrate, query, lint, index, log — and keep the wiki consistent.

## Root paths (authoritative)

| Layer | Path | Notes |
|-------|------|--------|
| Vault root (Obsidian) | `dstb-docs/` | Open this folder as the vault. |
| Wiki pages (agent-written) | `dstb-docs/wiki/` | Only the agent creates/updates these (unless the human explicitly edits). |
| Raw sources (immutable) | `dstb-docs/raw/` | Human drops files here; includes `raw/docs/` (legacy repo docs tree). |
| Navigation catalog | `dstb-docs/index.md` | Content-oriented index; **update on every ingest**. |
| Chronological log | `dstb-docs/log.md` | Append-only; **append after every ingest, major query artifact, or lint pass**. |
| Schema | `CLAUDE.md` (repo root) | Co-evolve with the human when conventions change. |

**Repository note:** The former top-level `docs/` folder is a **stub** that points humans and tools here. Canonical markdown sources for the trading bot live under `dstb-docs/raw/docs/`.

## Directory conventions

```
dstb-docs/
├── index.md                 # Master catalog (categories, links, one-line summaries)
├── log.md                   # Append-only timeline
├── Welcome.md               # Optional human-facing vault intro (may link to index)
├── wiki/
│   ├── overview.md          # High-level project + wiki map
│   ├── concepts/            # Abstract ideas, patterns, glossary-style pages
│   ├── entities/            # Components: CLI, TradingBot, Bitunix adapter, etc.
│   ├── sources/             # Per-source summary pages (one page per major ingest)
│   └── synthesis/           # Cross-cutting analyses, comparisons, theses
├── raw/
│   ├── README.md            # How to add sources
│   ├── assets/              # Downloaded images / attachments (Obsidian-friendly)
│   └── docs/                # Full legacy documentation tree (immutable archive)
└── .obsidian/               # Obsidian settings (do not remove)
```

**Naming:**

- Wiki files: `kebab-case.md`. Prefer short, stable names for entities (`trading-bot.md`, `bitunix-adapter.md`).
- New raw files dropped by the human: prefer `YYYY-MM-DD-short-slug.md` or preserve original filename if importing an external article.
- Source summary pages in `wiki/sources/` should link back to the raw path under `raw/`.

## Markdown conventions

- Use **double quotes** for string literals in any embedded examples within markdown where quotes are needed.
- Use Wikilinks where helpful for Obsidian: `[[wiki/overview|Overview]]`. Also use standard markdown links for GitHub compatibility: `[Overview](wiki/overview.md)`.
- Optional YAML frontmatter on wiki pages for Dataview / filtering:

```yaml
---
title: "Page title"
type: concept
updated: 2026-04-07
sources: 2
tags: [dstb, cli]
---
```

- When citing the codebase, use path form: `` `src/core/TradingBot.ts` ``.

## Workflows

### 1. Ingest (new material)

Triggered when the human adds or points to a file under `raw/` (or a path inside `raw/docs/` to treat as a new focus).

**Steps:**

1. Read the source completely (if large, read in sections and integrate).
2. Briefly confirm key takeaways with the human if ambiguity exists.
3. Create or update `wiki/sources/<slug>.md` with: title, link to raw file, summary, notable quotes/facts, open questions.
4. Update relevant `wiki/concepts/*` and `wiki/entities/*` pages; add cross-links.
5. If new information **contradicts** the wiki, edit the affected pages: state the conflict, date, and which source supports which view.
6. Update `wiki/overview.md` if project-level narrative changes.
7. Update `index.md` (new/updated rows in the right categories).
8. Append to `log.md` using the log entry format below.

A single source may touch many pages; that is expected.

### 2. Query (questions)

1. Read `index.md` first to locate relevant wiki pages.
2. Open those pages (and raw sources only if the wiki is insufficient).
3. Answer with citations: wiki path and/or `raw/` path.
4. If the answer is **durable value** (comparison table, deep analysis, new connections), offer to file it under `wiki/synthesis/` and update `index.md` + `log.md`.

### 3. Lint (health check)

When the human requests a wiki lint:

1. Scan for contradictory statements across wiki pages.
2. Flag stale claims vs newer `raw/docs/` or newer ingests.
3. List orphan wiki pages (no inbound wikilinks from `index.md` or other pages).
4. List important terms that lack concept/entity pages.
5. Suggest missing cross-references and optional web searches to fill gaps.
6. Append a **lint** entry to `log.md`.

## Log entry format

Every log entry is a level-2 heading for grep-friendly parsing:

```markdown
## [YYYY-MM-DD] ingest | Short title
- Raw: `raw/...`
- Wiki: updated `wiki/sources/...`, `wiki/entities/...`
- Notes: one line

## [YYYY-MM-DD] query | Short title
- Question: ...
- Output filed: `wiki/synthesis/...` (or "none — ephemeral")

## [YYYY-MM-DD] lint | Pass
- Findings: ...
```

Example Unix-style filter (adapt for Windows): `grep "^## \\[" dstb-docs/log.md`

## Index maintenance

`index.md` sections (adjust as the wiki grows):

- **Overview** — link to `wiki/overview.md`
- **Sources** — source summary pages + link to raw file
- **Entities** — systems, modules, external services
- **Concepts** — patterns, strategies, domain terms
- **Synthesis** — analyses and meta pages

Each entry: `- [[wiki/path|Title]] — one-line summary`

## Guardrails

- **Never modify** files under `raw/` except when the human explicitly asks to fix a typo or replace a source; default is immutable raw.
- **Do** edit freely under `dstb-docs/wiki/`, `dstb-docs/index.md`, and `dstb-docs/log.md` per workflows above.
- Do not delete historical log entries.
- Prefer updating existing wiki pages over duplicating; split pages when they grow too large.
- Stay consistent with repository code; if code and wiki disagree, note it and recommend code or wiki fix.

## First-time agent bootstrap

If `index.md` or `log.md` is missing, recreate them using this schema. If `wiki/overview.md` is missing, create it from `raw/docs/README.md` and the repository `README.md`, then expand.

---

*This schema implements the "LLM Wiki" pattern: a compounding, interlinked markdown knowledge base maintained by the agent, with humans curating sources and direction.*
