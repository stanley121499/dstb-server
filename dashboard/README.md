# DSTB Dashboard (Phase 2)

Next.js app for bot grid, config editor (with `config_versions`), and trade log. Uses Supabase Auth (email/password) and the **anon** key with RLS as `authenticated`.

## Setup

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. In Supabase: create users for Stanley/Darren; ensure RLS policies allow `authenticated` (see `supabase/migrations`).
3. **Auth URLs:** add your local URL (`http://localhost:3000`) and Vercel URL under Authentication → URL configuration.

## Monorepo

From the repo root:

```bash
npm install
npm run dashboard:dev
```

Build:

```bash
npm run dashboard:build
```

`next.config.ts` sets `turbopack.root` to the repo root so the hoisted `next` package resolves under npm workspaces.

## Credentials

Exchange API keys live in `configs.credentials_ref`. The dashboard **does not** edit them; set via Supabase Studio or your secure process. Saving a config preserves the existing `credentials_ref`.

## Params validation

- **orb-atr:** strict Zod validation (vendored in `lib/server/strategyParamsShared.ts` — keep in sync with `src/domain/strategyParams.ts`).
- **Other strategies:** save is allowed with a **warning** until a schema is added server-side (`lib/server/paramsValidation.ts`) and the client allowlist (`STRATEGIES_WITH_STRICT_PARAMS` in `components/config-editor-form.tsx`).

## Database

Apply migrations (including Realtime on `bots` for the live grid):

```bash
supabase db push
```

## Deploy (Vercel)

- Root directory: `dashboard`
- Env: same `NEXT_PUBLIC_*` vars
- Add the Vercel domain to Supabase auth redirect URLs
