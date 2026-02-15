# Core Infrastructure Module

This module provides SQLite state management, structured logging, and config loading for the DSTB bot.

## Components

- `StateManager`: SQLite-backed persistence for bots, positions, trades, and orders.
- `Logger`: Daily log files with JSON context and retention.
- `ConfigLoader`: JSON config loading with env substitution and Zod validation.

## Usage

```typescript
import path from "node:path";

import { ConfigLoader } from "./ConfigLoader";
import { Logger } from "./Logger";
import { StateManager } from "./StateManager";

const logDir = path.join(process.cwd(), "logs");
const logger = new Logger("bot-example", logDir);

const config = ConfigLoader.loadBotConfig("configs/bot.example.json");

const dbPath = path.join(process.cwd(), "data", "bot-state.db");
const schemaPath = path.join(process.cwd(), "data", "schema.sql");

const state = new StateManager({
  dbPath,
  schemaPath,
  logger
});

await state.createBot(config);
```

## Testing

Run the core tests from the repository root:

```bash
npm run test:core
```
