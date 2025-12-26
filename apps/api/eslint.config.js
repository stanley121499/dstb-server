import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * ESLint v9+ flat config for the API workspace.
 *
 * This repo uses Node.js + TypeScript (ESM), and the workspace script runs `eslint .`.
 * ESLint v9 requires an `eslint.config.*` file (it no longer reads `.eslintrc.*` by default).
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Enforce this repo's TypeScript safety standards (docs/18-dev-standards.md)
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",

      // Prefer explicit type imports to avoid runtime import side-effects.
      "@typescript-eslint/consistent-type-imports": ["error", { "prefer": "type-imports" }]
    }
  }
);




