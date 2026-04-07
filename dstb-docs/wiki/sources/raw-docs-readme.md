---
title: "Source summary — raw/docs/README.md"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, ingest, documentation]
---

# Source summary: `raw/docs/README.md`

**Raw path:** [`raw/docs/README.md`](../raw/docs/README.md)  
**Ingest date:** 2026-04-07  
**Role:** Master documentation index for DSTB v2.0 (Stable CLI System), last updated February 2026 per file header.

## Summary

The README defines the **documentation index** (glossary, strategies, architecture, deployment, CLI, monitoring, exchange handling, Bitunix adapter, credentials), a **recommended reading order** for newcomers, a **project tree** centered on `src/`, `configs/`, `data/`, `logs/`, and a **status table** (completed vs removed components such as monorepo frontend and Supabase). It states principles: docs are source of truth; resolve conflicts in code or docs deliberately.

## Notable facts

- Version line: **2.0 (Stable CLI System)**.
- Quick start order: architecture → deployment → CLI → strategy plugins → monitoring.
- External links include Bitunix OpenAPI docs, Luxon, SQLite, Telegram Bot API, Google Sheets API.

## Migration notes

- `raw/docs/README.md` was updated 2026-04-07 to describe `dstb-docs/` and the stub `docs/` pointer. The **live** doc tree path is `dstb-docs/raw/docs/`; repository root `docs/README.md` redirects to the vault.

## Open questions

- Whether numbered doc IDs (00, 12, 14, …) in the table should be normalized to filenames everywhere (some code comments still reference old `docs/NN-*.md` names).

## Cross-references

- [[../overview|Wiki overview]]
- [[../concepts/documentation-index|Documentation index (wiki)]]
