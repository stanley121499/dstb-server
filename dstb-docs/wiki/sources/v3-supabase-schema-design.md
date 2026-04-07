---
title: "Source summary — Supabase Schema Design v3"
type: source-summary
updated: 2026-04-07
sources: 1
tags: [dstb, supabase, schema, behavior]
---

# Source summary: Supabase Schema Design v3

**Raw path:** [`raw/2026-04-07-schema-design-v3.md`](../../raw/2026-04-07-schema-design-v3.md)  
**Date (document):** 2026-04-07 · **Status:** Planning

## Summary

Postgres schema intended to replace **`data/bot-state.db`** and **`configs/strategies/*.json`**. Four domains: **bot management** (`configs`, `config_versions`, `bots`, `orders`), **trade data** (`trades`, `positions`, `trade_candles`), **operational** (`bot_logs`), **behavior** (`behavior_analyzers`, `behavior_rulesets`, `behavior_raw_cycles`, `behavior_results`, `behavior_environments`). Includes **RLS** notes (service role vs authenticated; hide `configs.credentials_ref` from dashboard), **Realtime** subscription matrix for config-driven control plane, and **migration notes** from SQLite/JSON.

## Notable design choices

- `configs.enabled` replaces `bot-stopped-state.json`; `config_versions` audits param changes.
- `trades` carries `config_version`, `config_snapshot`, `exit_reason`, `metadata`.
- `trade_candles` stores JSONB candle arrays per timeframe for charting.
- Behavior: raw cycles **immutable**; results keyed by `(raw_cycle_id, ruleset_id)` with JSONB `columns` for analyzer outputs.
- `behavior_environments` tracks pipeline status `candidate` → … → `live` | `retired` and optional `config_id` link when promoted.

## Cross-references

- [[../synthesis/v3-planning-document-set|v3 planning document set]]
- [[v3-phase-rollout-plan|Phase Rollout Plan v3]]
