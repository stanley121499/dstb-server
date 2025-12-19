/**
 * @file Minimal Supabase Database type for Phase 1 tables.
 *
 * Why this exists:
 * - `@supabase/supabase-js` uses a generic `Database` type to strongly type `.from("table")`.
 * - Without providing a Database schema, table names/types can collapse to `never` under strict TS.
 *
 * Scope:
 * - Phase 1 tables only (docs/17-supabase-schema-and-migrations.md)
 * - Keep JSONB columns as `unknown` so we can validate with Zod at the boundaries.
 */

export type Database = {
  public: {
    Tables: {
      parameter_sets: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          updated_at: string;
          name: string;
          description: string | null;
          params_version: string;
          params: unknown;
          is_deleted: boolean;
        };
        Insert: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name: string;
          description: string | null;
          params_version: string;
          params: unknown;
          is_deleted?: boolean;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name?: string;
          description?: string | null;
          params_version?: string;
          params?: unknown;
          is_deleted?: boolean;
        };
        Relationships: [];
      };

      backtest_runs: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          status: string;
          parameter_set_id: string | null;
          params_snapshot: unknown;
          engine_version: string;
          symbol: string;
          interval: string;
          start_time_utc: string;
          end_time_utc: string;
          initial_equity: unknown;
          final_equity: unknown;
          total_return_pct: unknown;
          max_drawdown_pct: unknown;
          win_rate_pct: unknown;
          profit_factor: unknown;
          trade_count: unknown;
          data_source: string;
          data_fingerprint: unknown;
          error_message: string | null;
        };
        Insert: Record<string, unknown> & {
          id: string;
          created_at?: string;
          status: string;
          parameter_set_id: string | null;
          params_snapshot: unknown;
          engine_version: string;
          symbol: string;
          interval: string;
          start_time_utc: string;
          end_time_utc: string;
          initial_equity: number;
          final_equity?: number | null;
          total_return_pct?: number | null;
          max_drawdown_pct?: number | null;
          win_rate_pct?: number | null;
          profit_factor?: number | null;
          trade_count?: number | null;
          data_source: string;
          data_fingerprint: unknown;
          error_message: string | null;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          status?: string;
          parameter_set_id?: string | null;
          params_snapshot?: unknown;
          engine_version?: string;
          symbol?: string;
          interval?: string;
          start_time_utc?: string;
          end_time_utc?: string;
          initial_equity?: number;
          final_equity?: number | null;
          total_return_pct?: number | null;
          max_drawdown_pct?: number | null;
          win_rate_pct?: number | null;
          profit_factor?: number | null;
          trade_count?: number | null;
          data_source?: string;
          data_fingerprint?: unknown;
          error_message?: string | null;
        };
        Relationships: [];
      };

      backtest_trades: {
        Row: Record<string, unknown> & {
          id: string;
          run_id: string;
          session_date_ny: string;
          direction: string;
          entry_time_utc: string;
          entry_price: unknown;
          exit_time_utc: string;
          exit_price: unknown;
          quantity: unknown;
          fee_total: unknown;
          pnl: unknown;
          r_multiple: unknown;
          exit_reason: string;
        };
        Insert: Record<string, unknown> & {
          id: string;
          run_id: string;
          session_date_ny: string;
          direction: "long" | "short";
          entry_time_utc: string;
          entry_price: number;
          exit_time_utc: string;
          exit_price: number;
          quantity: number;
          fee_total: number;
          pnl: number;
          r_multiple: number | null;
          exit_reason: string;
        };
        Update: Record<string, unknown> & {
          id?: string;
          run_id?: string;
          session_date_ny?: string;
          direction?: "long" | "short";
          entry_time_utc?: string;
          entry_price?: number;
          exit_time_utc?: string;
          exit_price?: number;
          quantity?: number;
          fee_total?: number;
          pnl?: number;
          r_multiple?: number | null;
          exit_reason?: string;
        };
        Relationships: [];
      };

      run_events: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          run_id: string;
          level: string;
          code: string;
          message: string;
          context: unknown;
        };
        Insert: Record<string, unknown> & {
          id: string;
          created_at?: string;
          run_id: string;
          level: "info" | "warn" | "error";
          code: string;
          message: string;
          context: Record<string, unknown>;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          run_id?: string;
          level?: "info" | "warn" | "error";
          code?: string;
          message?: string;
          context?: Record<string, unknown>;
        };
        Relationships: [];
      };

      backtest_equity_points: {
        Row: Record<string, unknown> & {
          id: string;
          run_id: string;
          time_utc: string;
          equity: unknown;
        };
        Insert: Record<string, unknown> & {
          id: string;
          run_id: string;
          time_utc: string;
          equity: number;
        };
        Update: Record<string, unknown> & {
          id?: string;
          run_id?: string;
          time_utc?: string;
          equity?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

