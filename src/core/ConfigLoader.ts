import fs from "node:fs";

import { ZodError } from "zod";

import { BotConfig, botConfigSchema, StrategyConfig, strategyConfigSchema } from "./types";

/**
 * ConfigLoader loads, substitutes, and validates JSON configuration files.
 */
export class ConfigLoader {
  /**
   * Load and validate a bot config JSON file.
   *
   * Inputs:
   * - path: File path to bot config.
   *
   * Outputs:
   * - BotConfig instance.
   *
   * Error behavior:
   * - Logs errors and throws with clear messages.
   */
  static loadBotConfig(path: string): BotConfig {
    try {
      const raw = this.loadJsonFile(path);
      const substituted = this.substituteEnvVars(raw);
      return this.validateConfig(substituted);
    } catch (error) {
      const message = this.normalizeError(error);
      console.error(`[ConfigLoader] Failed to load bot config: ${message}`);
      throw new Error(`Failed to load bot config: ${message}`);
    }
  }

  /**
   * Load and validate a strategy config JSON file.
   *
   * Inputs:
   * - path: File path to strategy config.
   *
   * Outputs:
   * - StrategyConfig instance.
   *
   * Error behavior:
   * - Logs errors and throws with clear messages.
   */
  static loadStrategyConfig(path: string): StrategyConfig {
    try {
      const raw = this.loadJsonFile(path);
      const substituted = this.substituteEnvVars(raw);
      return this.validateStrategyConfig(substituted);
    } catch (error) {
      const message = this.normalizeError(error);
      console.error(`[ConfigLoader] Failed to load strategy config: ${message}`);
      throw new Error(`Failed to load strategy config: ${message}`);
    }
  }

  /**
   * Validate a raw bot config object.
   *
   * Inputs:
   * - config: Unknown config payload.
   *
   * Outputs:
   * - BotConfig instance.
   *
   * Error behavior:
   * - Throws with formatted Zod errors.
   */
  static validateConfig(config: unknown): BotConfig {
    const parsed = botConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new Error(this.formatZodError(parsed.error));
    }

    return parsed.data;
  }

  /**
   * Validate a raw strategy config object.
   */
  private static validateStrategyConfig(config: unknown): StrategyConfig {
    const parsed = strategyConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new Error(this.formatZodError(parsed.error));
    }

    return parsed.data;
  }

  /**
   * Load JSON file contents.
   */
  private static loadJsonFile(path: string): unknown {
    const raw = fs.readFileSync(path, "utf8");
    return JSON.parse(raw) as unknown;
  }

  /**
   * Substitute ${ENV_VAR} tokens in config objects.
   */
  private static substituteEnvVars(value: unknown): unknown {
    if (typeof value === "string") {
      return this.replaceEnvTokens(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.substituteEnvVars(item));
    }

    if (this.isRecord(value)) {
      const result: Record<string, unknown> = {};

      Object.entries(value).forEach(([key, entryValue]) => {
        result[key] = this.substituteEnvVars(entryValue);
      });

      return result;
    }

    return value;
  }

  /**
   * Replace ${ENV_VAR} tokens inside strings.
   */
  private static replaceEnvTokens(value: string): string {
    const missing: string[] = [];
    const result = value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, envKey: string) => {
      const envValue = process.env[envKey];
      if (envValue === undefined) {
        missing.push(envKey);
        return match;
      }

      return envValue;
    });

    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }

    return result;
  }

  /**
   * Check if a value is a plain object.
   */
  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * Format Zod validation errors into a readable message.
   */
  private static formatZodError(error: ZodError): string {
    return error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        const location = path.length > 0 ? ` at ${path}` : "";
        return `${issue.message}${location}`;
      })
      .join("; ");
  }

  /**
   * Normalize unknown errors into strings.
   */
  private static normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    return "Unknown error";
  }
}
