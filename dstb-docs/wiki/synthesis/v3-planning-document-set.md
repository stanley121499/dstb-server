---
title: "Synthesis — v3 planning document set (Supabase + dashboard)"
type: synthesis
updated: 2026-04-07
sources: 5
tags: [dstb, planning, supabase]
---

# Synthesis: v3 planning document set

This page ties together the **2026-04-07** planning markdown files in `dstb-docs/raw/` that describe a move from **CLI + SQLite + JSON configs** to **Supabase + Next.js dashboard + sandboxed behavior analyzers**.

## Raw documents (one line each)

| Raw file | Role |
|----------|------|
| [`2026-04-07-architecture-plan-v3.md`](../../raw/2026-04-07-architecture-plan-v3.md) | System diagram: dashboard ↔ Supabase ↔ bot server (Render) + backtest; principles (Supabase SOT, no local disk, Realtime control plane, `isolated-vm` analyzers). |
| [`2026-04-07-schema-design-v3.md`](../../raw/2026-04-07-schema-design-v3.md) | DDL-level schema: configs through behavior tables; RLS; Realtime; SQLite/JSON migration notes. |
| [`2026-04-07-phase-plan-v3.md`](../../raw/2026-04-07-phase-plan-v3.md) | Phased delivery 1–6, dependencies, Darren impact per phase. |
| [`2026-04-07-behavior-system-design.md`](../../raw/2026-04-07-behavior-system-design.md) | Problem (Sheets + hand-coded analyzers); solution (LLM → JS → Supabase → sandbox); helper API expectations. |
| [`2026-04-07-dashboard-spec.md`](../../raw/2026-04-07-dashboard-spec.md) | Next.js on Vercel, pages (`/`, `/config`, `/trades`, behavior routes), stack (Lightweight Charts, shadcn, RHF+Zod). |

## Relation to the repository today

| Topic | Current repo (typical) | v3 plan |
|--------|-------------------------|---------|
| State | SQLite `data/bot-state.db` | Supabase Postgres |
| Configs | `configs/strategies/*.json`, stop state file | `configs` table + Realtime |
| UI | None (CLI); Sheets for behavior | Next.js dashboard |
| Behavior analyzers | TypeScript in repo | JS in DB + sandbox runner |

**The wiki’s [[../overview|overview]] and `raw/docs/` still describe the shipped system.** The v3 set is **forward-looking**; contradictions are expected until implementation lands.

## Cross-references

- [[../sources/v3-phase-rollout-plan|Source: Phase plan]]
- [[../sources/v3-supabase-schema-design|Source: Schema design]]
- [[../sources/behavior-backtest-csv-3-0|Source: Behavior CSV samples]]
- [[../concepts/supabase-v3-migration|Concept: Supabase v3 migration (planned)]]
