---
title: "Source summary — Behavior Backtest 3.0 CSV exports"
type: source-summary
updated: 2026-04-07
sources: 2
tags: [dstb, behavior, csv, sheets]
---

# Source summary: Behavior Backtest 3.0 CSV exports

**Raw paths (immutable):**

- [`raw/3.0_Behavior_Backtest_01 - 1) BEHAVIOR-RAW DATA.csv`](../../raw/3.0_Behavior_Backtest_01%20-%201)%20BEHAVIOR-RAW%20DATA.csv) — large row-level sheet (~3.7k+ lines); wide layout with section headers for INTERACT / DECISION / OUTCOME columns.
- [`raw/3.0_Behavior_Backtest_01 - 2) BEHAVIOR-ENVIRONMENT-OVERVIEW (1).csv`](../../raw/3.0_Behavior_Backtest_01%20-%202)%20BEHAVIOR-ENVIRONMENT-OVERVIEW%20(1).csv) — environment ranking / checklist; columns include Previous-Day Level, Asia Range, session timing, interaction behavior, decision/outcome biases, MoveScore, Environment Score/Grade/Rank.

## Summary

These are **Google Sheets-style exports** supporting the behavior taxonomy (interaction → decision → outcome) and **environment scoring** for where strategies should be allowed. The RAW DATA file includes fields such as Entry Date, UID, TradingView Link, Pair, Day, and grouped analyzer columns; the ENVIRONMENT-OVERVIEW file explains how columns are built and ranks environments by metrics.

## Wiki use

Treat as **reference samples** for column semantics when aligning [[v3-supabase-schema-design|Schema Design v3]] `behavior_results.columns` and dashboard columns with legacy Sheets. Not parsed into structured DB rows in this ingest.

## Cross-references

- `raw/docs/behavior-bot-v4.md` — current behavior bot spec (code/Sheets oriented)
- [[../synthesis/v3-planning-document-set|v3 planning document set]]
