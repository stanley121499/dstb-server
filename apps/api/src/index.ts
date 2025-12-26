import "dotenv/config";

import { createServer } from "./server/createServer.js";
import { readEnv } from "./server/env.js";

/**
 * Boots the API server.
 *
 * Errors:
 * - Throws if required environment variables are missing/invalid.
 * - Exits the process if the server fails to start.
 */
const env = readEnv(process.env);
const server = await createServer({ env });

try {
  await server.listen({ host: "0.0.0.0", port: env.PORT });
} catch (err: unknown) {
  // Fastify can throw non-Error values; keep it safe and explicit.
  const message = err instanceof Error ? err.message : "Unknown listen error";
  server.log.error({ err, message }, "Failed to start server");
  process.exitCode = 1;
}





