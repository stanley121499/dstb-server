# Raw sources (immutable)

Drop **new** material here for the LLM Wiki agent to ingest.

- **Text / markdown / PDFs (as available):** add with a clear name, e.g. `2026-04-07-bitunix-rate-limits-note.md`.
- **Images:** prefer `assets/` so Obsidian and the agent can resolve paths reliably (see `CLAUDE.md` and Obsidian attachment settings).

The agent **reads** this tree and **writes** only under `dstb-docs/wiki/`, plus `index.md` and `log.md`.

**Existing repo documentation** was moved to `raw/docs/` (full tree including Bitunix HTML exports and markdown). Do not treat that move as an ingest by itself — wiki pages reference it as the canonical doc archive.
