import type { z } from "zod";

import { orbAtrParamsBodySchema } from "./strategyParamsShared";

/**
 * Returns the Zod schema for `configs.params` JSON for the given strategy slug, or null if none.
 */
export function getParamsValidator(strategy: string): z.ZodTypeAny | null {
  if (strategy === "orb-atr") {
    return orbAtrParamsBodySchema;
  }
  return null;
}

/**
 * Flatten Zod issues for display next to the JSON editor.
 */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}
