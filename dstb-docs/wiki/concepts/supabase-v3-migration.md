---
title: "Concept — Supabase + dashboard migration (v3 plan)"
type: concept
updated: 2026-04-07
sources: 5
tags: [dstb, supabase, migration]
---

# Concept: Supabase + dashboard migration (v3 plan)

**Status:** Planning (2026-04-07 documents). Not implemented as a single cutover in the repo at time of writing.

## Definition

The **v3 plan** is the initiative to replace local **SQLite** and file-based **strategy JSON** with **Supabase** as the durable store, add a **Next.js dashboard** for Stanley/Darren, and move **behavior analysis** from Google Sheets + hand-written TypeScript toward **LLM-generated JavaScript** stored in Postgres and executed in a **sandbox** (`isolated-vm`).

## Why it appears in the wiki

Raw sources [`2026-04-07-*.md`](../../raw/) define intended tables, UX, and phased rollout. This concept page gives a stable wiki anchor for “future architecture” discussions without overwriting [[documentation-index|legacy doc index]] entries that describe **today’s** CLI bot.

## See also

- [[../synthesis/v3-planning-document-set|v3 planning document set]]
- [[../sources/v3-phase-rollout-plan|Phase Rollout Plan v3]]
- [[../sources/v3-supabase-schema-design|Supabase Schema Design v3]]
