---
title: "Concept — Supabase + dashboard migration (v3 plan)"
type: concept
updated: 2026-04-07
sources: 13
tags: [dstb, supabase, migration]
---

# Concept: Supabase + dashboard migration (v3 plan)

**Status (2026-04-07):** **Phases 1–4** delivered on the main path for **behavior data + UI core**: Phases 1–3 as before; **Phase 4** = behavior tables + sync + `isolated-vm` runner + **`/behavior`** dashboard + backfill CLI ([[../sources/phase4-behavior-implementation|Phase 4 implementation raw]]). **Phases 5–6** (ruleset/analyzer editor UI, environment pipeline UI) **planned**. **Heartbeat** grid accuracy: [[../sources/bot-heartbeat-vs-candle-interval|ops note]]. Dashboard **spec gap** / UX polish: [[post-phases-dashboard-polish|post-phases polish]]. **E2E** not yet in CI: [[../sources/e2e-testing-v3-backlog|E2E backlog]].

## Definition

The **v3 plan** is the initiative to replace local **SQLite** and file-based **strategy JSON** with **Supabase** as the durable store, add a **Next.js dashboard** for Stanley/Darren, and move **behavior analysis** from Google Sheets + hand-written TypeScript toward **LLM-generated JavaScript** stored in Postgres and executed in a **sandbox** (`isolated-vm`).

## Why it appears in the wiki

Raw sources [`2026-04-07-*.md`](../../raw/) define tables, UX, and phased rollout; [[../sources/deploy-runtime-supabase-notes|deploy/runtime notes]] capture how Phase 1 is wired today. Legacy **`raw/docs/architecture.md`** may still read SQLite-first — use this concept + synthesis when discussing **current** hybrid state.

## See also

- [[../synthesis/v3-planning-document-set|v3 planning document set]]
- [[../sources/v3-phase-rollout-plan|Phase Rollout Plan v3]]
- [[../sources/v3-supabase-schema-design|Supabase Schema Design v3]]
- [[../sources/deploy-runtime-supabase-notes|Deploy / runtime / Supabase notes]]
- [[../sources/bot-logs-gap-and-integration-plan|bot_logs gap + integration plan]]
- [[../sources/dashboard-phase2-status|Dashboard Phase 2 status]]
- [[../entities/dstb-dashboard|DSTB dashboard entity]]
- [[post-phases-dashboard-polish|Post-phases dashboard polish]]
- [[../sources/phase3-implementation-summary|Phase 3 implementation summary]]
- [[../sources/phase4-behavior-implementation|Phase 4 behavior implementation]]
- [[../sources/bot-heartbeat-vs-candle-interval|Heartbeat vs candle interval]]
- [[../sources/e2e-testing-v3-backlog|E2E testing backlog]]
