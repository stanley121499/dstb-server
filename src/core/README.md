# Core Infrastructure Module

This module provides **Supabase-backed** persistence (`SupabaseStateStore`), an **in-memory** store for tests/offline scripts (`InMemoryBotStateStore`), structured logging, and config loading.

## Components

- `BotStateStore`: interface implemented by `SupabaseStateStore` and `InMemoryBotStateStore`.
- `SupabaseStateStore`: Postgres persistence via `@supabase/supabase-js` (service role).
- `InMemoryBotStateStore`: in-memory implementation for unit tests and replay scripts.
- `Logger`: daily log files with JSON context and retention.
- `ConfigLoader`: JSON config loading with env substitution and Zod validation.

## Usage (production / CLI)

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then:

```typescript
import { Logger } from "./Logger.js";
import { SupabaseStateStore } from "./SupabaseStateStore.js";

const logger = new Logger("bot-example", "logs");
const store = SupabaseStateStore.fromEnv(logger);
await store.createBot(config);
```

## Testing

```bash
npm run test:core
```
