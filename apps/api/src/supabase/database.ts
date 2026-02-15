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

      bots: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          updated_at: string;
          name: string;
          status: string;
          exchange: string;
          symbol: string;
          interval: string;
          params_snapshot: unknown;
          initial_balance: unknown;
          current_balance: unknown;
          current_equity: unknown;
          max_daily_loss_pct: unknown;
          max_position_size_pct: unknown;
          error_message: string | null;
          error_count: number;
          last_heartbeat_at: string | null;
          started_at: string | null;
          stopped_at: string | null;
        };
        Insert: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name: string;
          status: string;
          exchange: string;
          symbol: string;
          interval: string;
          params_snapshot: unknown;
          initial_balance: number;
          current_balance: number;
          current_equity: number;
          max_daily_loss_pct: number;
          max_position_size_pct: number;
          error_message?: string | null;
          error_count?: number;
          last_heartbeat_at?: string | null;
          started_at?: string | null;
          stopped_at?: string | null;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name?: string;
          status?: string;
          exchange?: string;
          symbol?: string;
          interval?: string;
          params_snapshot?: unknown;
          initial_balance?: number;
          current_balance?: number;
          current_equity?: number;
          max_daily_loss_pct?: number;
          max_position_size_pct?: number;
          error_message?: string | null;
          error_count?: number;
          last_heartbeat_at?: string | null;
          started_at?: string | null;
          stopped_at?: string | null;
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

      live_orders: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          updated_at: string;
          bot_id: string;
          exchange: string;
          exchange_order_id: string | null;
          client_order_id: string;
          symbol: string;
          side: string;
          type: string;
          status: string;
          quantity: unknown;
          price: unknown;
          stop_price: unknown;
          filled_quantity: unknown;
          avg_fill_price: unknown;
          fee_paid: unknown;
          fee_currency: string | null;
          time_in_force: string | null;
          request_payload: unknown;
          exchange_response: unknown;
          error_message: string | null;
          submitted_at: string | null;
          filled_at: string | null;
          cancelled_at: string | null;
          parent_position_id: string | null;
        };
        Insert: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          bot_id: string;
          exchange: string;
          exchange_order_id?: string | null;
          client_order_id: string;
          symbol: string;
          side: string;
          type: string;
          status: string;
          quantity: number;
          price?: number | null;
          stop_price?: number | null;
          filled_quantity?: number;
          avg_fill_price?: number | null;
          fee_paid?: number | null;
          fee_currency?: string | null;
          time_in_force?: string | null;
          request_payload?: unknown;
          exchange_response?: unknown;
          error_message?: string | null;
          submitted_at?: string | null;
          filled_at?: string | null;
          cancelled_at?: string | null;
          parent_position_id?: string | null;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          bot_id?: string;
          exchange?: string;
          exchange_order_id?: string | null;
          client_order_id?: string;
          symbol?: string;
          side?: string;
          type?: string;
          status?: string;
          quantity?: number;
          price?: number | null;
          stop_price?: number | null;
          filled_quantity?: number;
          avg_fill_price?: number | null;
          fee_paid?: number | null;
          fee_currency?: string | null;
          time_in_force?: string | null;
          request_payload?: unknown;
          exchange_response?: unknown;
          error_message?: string | null;
          submitted_at?: string | null;
          filled_at?: string | null;
          cancelled_at?: string | null;
          parent_position_id?: string | null;
        };
        Relationships: [];
      };

      live_positions: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          updated_at: string;
          bot_id: string;
          exchange: string;
          symbol: string;
          direction: string;
          status: string;
          entry_order_id: string | null;
          entry_time: string;
          entry_price: unknown;
          quantity: unknown;
          stop_loss_price: unknown;
          take_profit_price: unknown;
          trailing_stop_price: unknown;
          stop_order_id: string | null;
          tp_order_id: string | null;
          current_price: unknown;
          unrealized_pnl: unknown;
          realized_pnl: unknown;
          fee_total: unknown;
          risk_amount: unknown;
          r_multiple: unknown;
          session_date_ny: string;
          closed_at: string | null;
          exit_reason: string | null;
        };
        Insert: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          bot_id: string;
          exchange: string;
          symbol: string;
          direction: string;
          status: string;
          entry_order_id?: string | null;
          entry_time: string;
          entry_price: number;
          quantity: number;
          stop_loss_price?: number | null;
          take_profit_price?: number | null;
          trailing_stop_price?: number | null;
          stop_order_id?: string | null;
          tp_order_id?: string | null;
          current_price?: number | null;
          unrealized_pnl?: number | null;
          realized_pnl?: number | null;
          fee_total?: number | null;
          risk_amount?: number | null;
          r_multiple?: number | null;
          session_date_ny: string;
          closed_at?: string | null;
          exit_reason?: string | null;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          bot_id?: string;
          exchange?: string;
          symbol?: string;
          direction?: string;
          status?: string;
          entry_order_id?: string | null;
          entry_time?: string;
          entry_price?: number;
          quantity?: number;
          stop_loss_price?: number | null;
          take_profit_price?: number | null;
          trailing_stop_price?: number | null;
          stop_order_id?: string | null;
          tp_order_id?: string | null;
          current_price?: number | null;
          unrealized_pnl?: number | null;
          realized_pnl?: number | null;
          fee_total?: number | null;
          risk_amount?: number | null;
          r_multiple?: number | null;
          session_date_ny?: string;
          closed_at?: string | null;
          exit_reason?: string | null;
        };
        Relationships: [];
      };

      live_trades: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          bot_id: string;
          position_id: string | null;
          exchange: string;
          symbol: string;
          direction: string;
          entry_time: string;
          entry_price: unknown;
          exit_time: string;
          exit_price: unknown;
          quantity: unknown;
          fee_total: unknown;
          pnl: unknown;
          r_multiple: unknown;
          exit_reason: string;
          session_date_ny: string;
          entry_order_id: string | null;
          exit_order_id: string | null;
          max_favorable_excursion: unknown;
          max_adverse_excursion: unknown;
        };
        Insert: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          bot_id: string;
          position_id?: string | null;
          exchange: string;
          symbol: string;
          direction: string;
          entry_time: string;
          entry_price: number;
          exit_time: string;
          exit_price: number;
          quantity: number;
          fee_total: number;
          pnl: number;
          r_multiple?: number | null;
          exit_reason: string;
          session_date_ny: string;
          entry_order_id?: string | null;
          exit_order_id?: string | null;
          max_favorable_excursion?: number | null;
          max_adverse_excursion?: number | null;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          bot_id?: string;
          position_id?: string | null;
          exchange?: string;
          symbol?: string;
          direction?: string;
          entry_time?: string;
          entry_price?: number;
          exit_time?: string;
          exit_price?: number;
          quantity?: number;
          fee_total?: number;
          pnl?: number;
          r_multiple?: number | null;
          exit_reason?: string;
          session_date_ny?: string;
          entry_order_id?: string | null;
          exit_order_id?: string | null;
          max_favorable_excursion?: number | null;
          max_adverse_excursion?: number | null;
        };
        Relationships: [];
      };

      bot_logs: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          bot_id: string;
          level: string;
          category: string;
          message: string;
          context: unknown;
          position_id: string | null;
          order_id: string | null;
        };
        Insert: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          bot_id: string;
          level: string;
          category: string;
          message: string;
          context: unknown;
          position_id?: string | null;
          order_id?: string | null;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          bot_id?: string;
          level?: string;
          category?: string;
          message?: string;
          context?: unknown;
          position_id?: string | null;
          order_id?: string | null;
        };
        Relationships: [];
      };

      account_snapshots: {
        Row: Record<string, unknown> & {
          id: string;
          created_at: string;
          bot_id: string;
          exchange: string;
          balance: unknown;
          equity: unknown;
          open_positions_count: number;
          total_unrealized_pnl: unknown;
          daily_pnl: unknown;
          total_pnl_since_start: unknown;
          snapshot_type: string;
        };
        Insert: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          bot_id: string;
          exchange: string;
          balance: number;
          equity: number;
          open_positions_count: number;
          total_unrealized_pnl: number;
          daily_pnl: number;
          total_pnl_since_start: number;
          snapshot_type: string;
        };
        Update: Record<string, unknown> & {
          id?: string;
          created_at?: string;
          bot_id?: string;
          exchange?: string;
          balance?: number;
          equity?: number;
          open_positions_count?: number;
          total_unrealized_pnl?: number;
          daily_pnl?: number;
          total_pnl_since_start?: number;
          snapshot_type?: string;
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





