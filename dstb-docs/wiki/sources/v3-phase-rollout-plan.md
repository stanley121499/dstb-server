---
title: "Source summary — Phase Rollout Plan v3"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, planning, supabase, dashboard]
---

# Source summary: Phase Rollout Plan v3

**Raw path:** [`raw/2026-04-07-phase-plan-v3.md`](../../raw/2026-04-07-phase-plan-v3.md)  
**Date (document):** 2026-04-07 · **Status:** Planning

## Summary

Six-phase roadmap from **Supabase + bot server migration** through **dashboard**, **trade analytics**, **behavior system in DB**, **ruleset self-service**, to **environment pipeline** and advanced ops. Est. **9–16 weeks** total; phases **2** and **4** can parallel after phase **1**. Guiding principles: each phase ships standalone value; avoid locking structure before domain clarity (v1 lesson); two users — **Stanley (coder)** and **Darren (strategist)** with Darren self-serve as a requirement.

## Phase outline

| Phase | Focus |
|-------|--------|
| 1 | Supabase schema, `SupabaseStateManager`, Realtime on `configs`, `/health`, Render Web Service, remove SQLite + JSON strategy files |
| 2 | Next.js `dashboard/`, bot grid, config editor + `config_versions`, trade log |
| 3 | Trade detail charts (`trade_candles`), P&L analytics, strategy comparison |
| 4 | Behavior tables + BehaviorBot → Supabase, `isolated-vm` `SandboxedAnalyzerRunner`, behavior results UI |
| 5 | LLM prompt template, analyzer editor, ruleset builder/comparison — Darren iterates without Stanley coding |
| 6 | Environment pipeline (candidate → live), backtest button, optional in-dashboard LLM, ops alerts |

## Relation to current codebase

**Contrast:** Today the repo is **CLI-first, SQLite, `configs/strategies/*.json`** per [[../overview|wiki overview]] and `raw/docs/`. This plan **supersedes** that operational model once executed; until then it is **planning only**.

## Cross-references

- Raw: [`2026-04-07-architecture-plan-v3.md`](../../raw/2026-04-07-architecture-plan-v3.md), [`2026-04-07-schema-design-v3.md`](../../raw/2026-04-07-schema-design-v3.md), [`2026-04-07-behavior-system-design.md`](../../raw/2026-04-07-behavior-system-design.md), [`2026-04-07-dashboard-spec.md`](../../raw/2026-04-07-dashboard-spec.md)
- [[../synthesis/v3-planning-document-set|v3 planning document set (synthesis)]]
