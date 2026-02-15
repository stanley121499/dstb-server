/*
  Enforce unique bot names.

  Notes:
  - Uses an idempotent unique index.
  - If duplicate names already exist, this migration will fail; resolve duplicates before re-running.
*/

create unique index if not exists uq_bots_name
  on public.bots (name);
