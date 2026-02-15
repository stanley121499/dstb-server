import type { ExchangeErrorCode, ExchangeErrorData } from "./types.js";

/**
 * Standardized error class for exchange adapters.
 */
export class ExchangeError extends Error {
  public readonly code: ExchangeErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  /**
   * Creates a new ExchangeError with a code and message.
   */
  public constructor(args: Readonly<{
    code: ExchangeErrorCode;
    message: string;
    details?: Readonly<Record<string, unknown>>;
  }>) {
    super(args.message);
    this.code = args.code;
    if (args.details !== undefined) {
      this.details = args.details;
    }
    this.name = "ExchangeError";
  }

  /**
   * Serializes the error into a plain object for logging/transport.
   */
  public toData(): ExchangeErrorData {
    const result: { code: ExchangeErrorCode; message: string; details?: Readonly<Record<string, unknown>> } = {
      code: this.code,
      message: this.message
    };
    if (this.details !== undefined) {
      result.details = this.details;
    }
    return result;
  }
}
