# DSTB LLM Wiki — log

Append-only timeline. Newest entries at the **bottom** (or top — stay consistent; this file uses **bottom** append).

---

## [2026-04-07] ingest | v3 planning raw files + behavior CSV exports

- **Raw:** `raw/2026-04-07-phase-plan-v3.md`, `raw/2026-04-07-schema-design-v3.md`, `raw/2026-04-07-architecture-plan-v3.md`, `raw/2026-04-07-behavior-system-design.md`, `raw/2026-04-07-dashboard-spec.md`, `raw/3.0_Behavior_Backtest_01 - 1) BEHAVIOR-RAW DATA.csv`, `raw/3.0_Behavior_Backtest_01 - 2) BEHAVIOR-ENVIRONMENT-OVERVIEW (1).csv`
- **Wiki:** added `wiki/sources/v3-phase-rollout-plan.md`, `wiki/sources/v3-supabase-schema-design.md`, `wiki/sources/behavior-backtest-csv-3-0.md`, `wiki/synthesis/v3-planning-document-set.md`, `wiki/concepts/supabase-v3-migration.md`; updated `wiki/overview.md`, `index.md`
- **Notes:** v3 set is forward-looking (Supabase + Next dashboard + sandboxed behavior); contrasts with current SQLite/CLI system documented in `raw/docs/`.

## [2026-04-07] ingest | raw/docs/README.md (documentation index)

- **Raw:** `dstb-docs/raw/docs/README.md`
- **Wiki:** added `wiki/overview.md`, `wiki/sources/raw-docs-readme.md`, `wiki/concepts/documentation-index.md`, `wiki/entities/dstb-trading-bot.md`; created `index.md`, `log.md`, `raw/README.md`, `raw/assets/`
- **Notes:** First formal ingest after migrating former repo `docs/` → `dstb-docs/raw/docs/`; top-level `docs/README.md` is now a pointer stub.

## [2026-04-07] meta | Vault bootstrap (LLM Wiki pattern)

- **Raw:** *(n/a — structural)*
- **Wiki:** established `CLAUDE.md` schema at repo root; defined folder conventions under `dstb-docs/`
- **Notes:** Obsidian vault remains `dstb-docs/`; agent maintains wiki + index + log per schema.

## [2026-04-07] ingest | patch raw/docs/README.md (paths after vault move)

- **Raw:** `dstb-docs/raw/docs/README.md` (project tree + principles lines)
- **Wiki:** refreshed [[wiki/sources/raw-docs-readme|source summary]] migration section
- **Notes:** Aligns archived README with `dstb-docs/` layout; no semantic spec change.
