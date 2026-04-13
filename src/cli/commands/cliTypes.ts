/**
 * Supported CLI command identifiers.
 */
export type CliCommand =
  | "start"
  | "stop"
  | "status"
  | "logs"
  | "backtest"
  | "reconcile"
  | "behavior:backtest"
  | "behavior:live"
  | "behavior:backfill-supabase";

/**
 * Parsed CLI arguments from argv input.
 */
export type ParsedCliArgs = Readonly<{
  command: CliCommand;
  flags: Readonly<Record<string, string>>;
  booleanFlags: Readonly<Record<string, boolean>>;
  positionals: readonly string[];
}>;

/**
 * Raw argv parse result for pre-validation.
 */
export type RawCliArgs = Readonly<{
  command: string | null;
  flags: Readonly<Record<string, string>>;
  booleanFlags: Readonly<Record<string, boolean>>;
  positionals: readonly string[];
}>;

/**
 * Standard output for reconcile command results.
 */
export type ReconcileResult = Readonly<{
  botId: string;
  botName: string;
  exchange: string;
  issues: readonly string[];
  fixed: boolean;
}>;
