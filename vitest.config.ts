import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for core module tests.
 */
export default defineConfig({
  test: {
    include: [
      "src/core/__tests__/**/*.test.ts",
      "src/strategies/__tests__/**/*.test.ts",
      "src/monitoring/__tests__/**/*.test.ts",
      "src/cli/__tests__/**/*.test.ts",
      "src/exchange/__tests__/**/*.test.ts"
    ],
    environment: "node",
    globals: true
  }
});
