# Strategy configs (v3)

Live strategy definitions are stored in **Supabase** (`configs` table), not in this folder.

- Use **Supabase Studio** or a future dashboard to create/update rows.
- **Seed migration:** `supabase/migrations/20260407120001_seed_configs_from_repo_json.sql` inserts paper strategies from git history plus an ETH Bitunix row matching `configs/examples/eth-live-v3.example.json` (your uncommitted `eth-live-v3.json` was not recoverable from git — adjust that row in Studio if it differed).
- On disk, `orb-btc-15m.json`, `orb-eth-1h.json`, and `sma-btc-15m.json` are restored from the last commit that contained them; use them for CLI/local reference.
- The server loads every row with `enabled = true` at startup and subscribes to **Realtime** changes on `configs`.

CLI `npm run bot -- start --config <file>` still accepts a JSON file for local runs; rows are upserted into Supabase by name+symbol when using the Supabase-backed store.
