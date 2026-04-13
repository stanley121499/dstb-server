import { BehaviorAnalyzer } from "../analyzer/BehaviorAnalyzer.js";
import { BehaviorSheetsReporter } from "../reporter/BehaviorSheetsReporter.js";
import { BehaviorDashboardReporter } from "../reporter/BehaviorDashboardReporter.js";
import { getCycleStartUtcMs, toDateString } from "../utils.js";
import type { Candle, DailyCycleInput, BehaviorRow } from "../types.js";
import type { IExchangeAdapter } from "../../exchange/IExchangeAdapter.js";
import type { BitunixMarketApi } from "../../exchange/BitunixMarketApi.js";
import type { TelegramAlerter } from "../../monitoring/TelegramAlerter.js";
import type { Logger } from "../../core/Logger.js";
import type { ExchangeCandle } from "../../exchange/types.js";
import { ExchangeError } from "../../exchange/ExchangeError.js";
import type { BehaviorSupabaseSync } from "../supabase/behaviorSupabaseSync.js";

type CycleState = {
  cycleStartUtcMs: number;
  candlesByTime: Map<number, Candle>;  // keyed by timeUtcMs for deduplication
  candles4h: readonly Candle[];
  pdh: number;
  pdl: number;
  uid: number;
  decisionAlertSent: boolean;
  outcomeAlertSent: boolean;
};

export type BehaviorBotOptions = Readonly<{
  exchangeAdapter: IExchangeAdapter;
  marketApi: BitunixMarketApi;
  telegramAlerter: TelegramAlerter | null;
  sheetsReporter: BehaviorSheetsReporter;
  /** Optional: dashboard reporter for BEHAVIOR-OVERVIEW-DASHBOARD tab. Refreshed after each cycle. */
  dashboardReporter: BehaviorDashboardReporter | null;
  pair: string;
  startUid: number;          // from env BEHAVIOR_START_UID, default 1
  logger: Logger;
  /** When set, each finalized cycle is upserted to Supabase (behavior_raw_cycles + behavior_results). */
  supabaseSync: BehaviorSupabaseSync | null;
}>;

export class BehaviorBot {
  private activeState!: CycleState;
  private pendingState: CycleState | null = null;  // previous day's lifecycle still completing
  private unsubscribe: (() => void) | null = null;
  private reconnectCount = 0;
  /** Accumulates every finalized BehaviorRow so the dashboard can be recomputed. */
  private allCompletedRows: BehaviorRow[] = [];

  constructor(private readonly options: BehaviorBotOptions) {
    this.handleCandles = this.handleCandles.bind(this);
    this.handleError = this.handleError.bind(this);
  }

  async start(): Promise<void> {
    try {
      this.options.logger.info("Initializing BehaviorBot...", { pair: this.options.pair });

      const loaded15m = await this.options.exchangeAdapter.getLatestCandles({ limit: 200 });
      // convert ExchangeCandle to Candle
      const parsed15m: Candle[] = loaded15m.map(c => ({
        timeUtcMs: c.timeUtcMs,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));

      // In BitunixMarketApi the interval param needs to be type YahooInterval, "4h" might not match types perfectly if not defined.
      // Assuming BitunixMarketApi maps '4h' correctly as shown in BitunixMarketApi.ts
      const loaded4h = await this.options.marketApi.getKline({
        symbol: this.options.pair,
        interval: "4h",
        limit: 270
      });
      const parsed4h: Candle[] = loaded4h.map(c => ({
        timeUtcMs: c.timeUtcMs,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));

      const cycleStartUtcMs = getCycleStartUtcMs(Date.now());
      const windowStart = cycleStartUtcMs - 8 * 3600 * 1000;

      const todayCandles = parsed15m.filter(c => c.timeUtcMs >= windowStart);
      const candlesByTime = new Map<number, Candle>();
      todayCandles.forEach(c => candlesByTime.set(c.timeUtcMs, c));

      // PDH/PDL from prior cycle's candles
      const priorStart = cycleStartUtcMs - 24 * 3600 * 1000;
      const priorCandles = parsed15m.filter(c => c.timeUtcMs >= priorStart && c.timeUtcMs < cycleStartUtcMs);
      const pdh = priorCandles.length > 0 ? Math.max(...priorCandles.map(c => c.high)) : 0;
      const pdl = priorCandles.length > 0 ? Math.min(...priorCandles.map(c => c.low)) : 0;

      this.activeState = {
        cycleStartUtcMs,
        candlesByTime,
        candles4h: parsed4h,
        pdh,
        pdl,
        uid: this.options.startUid,
        decisionAlertSent: false,
        outcomeAlertSent: false,
      };

      this.unsubscribe = await this.options.exchangeAdapter.subscribeToCandles({
        onCandles: this.handleCandles,
        onError: this.handleError
      });

      this.options.logger.info("BehaviorBot started successfully.");
    } catch (err) {
      this.options.logger.error("Failed to start BehaviorBot", { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    await this.options.exchangeAdapter.disconnect();
    this.options.logger.info("BehaviorBot stopped");
  }

  private handleCandles(candles: readonly ExchangeCandle[]): void {
    this.reconnectCount = 0;  // reset on successful candle receipt

    // Filter to CLOSED candles only
    const parsedCandles: Candle[] = candles.map(c => ({
      timeUtcMs: c.timeUtcMs,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));
    const closed = parsedCandles.filter(c => c.timeUtcMs + 15 * 60 * 1000 <= Date.now());

    // Add to active state (dedup by timeUtcMs)
    closed.forEach(c => this.activeState.candlesByTime.set(c.timeUtcMs, c));

    // Also feed to pending state if it exists
    if (this.pendingState !== null) {
      closed.forEach(c => this.pendingState!.candlesByTime.set(c.timeUtcMs, c));
      this.checkPendingLifecycle().catch(err => {
        this.options.logger.error("Error in checkPendingLifecycle", { error: err instanceof Error ? err.message : String(err) });
      });
    }

    // Check rollover
    const nextCycleStart = this.activeState.cycleStartUtcMs + 24 * 3600 * 1000;
    const hasOverflow = closed.some(c => c.timeUtcMs >= nextCycleStart);
    if (hasOverflow) {
      this.rollover().catch(err => {
        this.options.logger.error("Error in rollover", { error: err instanceof Error ? err.message : String(err) });
      });
    }

    // Incremental analysis on active state
    this.runIncrementalAnalysis().catch(err => {
      this.options.logger.error("Error in runIncrementalAnalysis", { error: err instanceof Error ? err.message : String(err) });
    });
  }

  private async rollover(): Promise<void> {
    const analyzer = new BehaviorAnalyzer();
    const tempRow = analyzer.analyze(this.buildInput(this.activeState));

    if (tempRow.lifecycleCrossedDayBoundary === "YES") {
      if (this.pendingState !== null) {
        // final finalization before overriding
        await this.finalizeLifecycle(this.pendingState);
      }
      this.pendingState = this.activeState;
    } else {
      await this.finalizeLifecycle(this.activeState);
    }

    const newCycleStart = this.activeState.cycleStartUtcMs + 24 * 3600 * 1000;
    const loaded4h = await this.options.marketApi.getKline({
      symbol: this.options.pair,
      interval: "4h",
      limit: 270
    });
    const parsed4h = loaded4h.map(c => ({ ...c, timeUtcMs: c.timeUtcMs }));

    const completedCandles = this.getSortedCandles(this.activeState);
    const newPdh = completedCandles.length > 0 ? Math.max(...completedCandles.map(c => c.high)) : 0;
    const newPdl = completedCandles.length > 0 ? Math.min(...completedCandles.map(c => c.low)) : 0;

    this.activeState = {
      cycleStartUtcMs: newCycleStart,
      candlesByTime: new Map(),
      candles4h: parsed4h,
      pdh: newPdh,
      pdl: newPdl,
      uid: this.activeState.uid + 1,
      decisionAlertSent: false,
      outcomeAlertSent: false,
    };
  }

  private async checkPendingLifecycle(): Promise<void> {
    if (this.pendingState === null) return;
    const analyzer = new BehaviorAnalyzer();
    const row = analyzer.analyze(this.buildInput(this.pendingState));

    if (row.lifecycleCrossedDayBoundary === "NO" || this.hasPassedOverflowWindow(this.pendingState)) {
      await this.finalizeLifecycle(this.pendingState);
      this.pendingState = null;
    }
  }

  private hasPassedOverflowWindow(state: CycleState): boolean {
    // Overflow window is 2 hours (8 15m candles) after cycle ends 
    // For safety, force finalize if it's been more than 2h past the boundary
    const nextCycleStart = state.cycleStartUtcMs + 24 * 3600 * 1000;
    const cutoff = nextCycleStart + 2.5 * 3600 * 1000;
    return Date.now() >= cutoff;
  }

  private async finalizeLifecycle(state: CycleState): Promise<void> {
    const analyzer = new BehaviorAnalyzer();
    const input = this.buildInput(state);
    const row = analyzer.analyze(input);

    try {
      await this.options.sheetsReporter.appendRow(row);
      this.options.logger.info("Lifecycle finalized and row appended", { date: row.date, pair: this.options.pair });

      this.allCompletedRows.push(row);

      if (this.options.dashboardReporter !== null) {
        await this.options.dashboardReporter.write(this.allCompletedRows);
        this.options.logger.info("Dashboard tab refreshed", { totalRows: this.allCompletedRows.length });
      }

      if (this.options.telegramAlerter) {
        const msg = `📊 <b>Daily Summary [${row.date}]</b>\n\n` +
          `Interaction: ${row.previousDayLevel} - ${row.twoCandleBehavior}\n` +
          `Decision: ${row.resolvedDecisionOutput}\n` +
          `Outcome: ${row.resolvedOutcomeDirection} (${row.resolvedOutcomeQuality})`;
        await this.options.telegramAlerter.sendAlert({
          level: "INFO",
          message: msg,
          botId: "BehaviorBot"
        });
      }
    } catch (err) {
      this.options.logger.error("Failed to append row", { error: err instanceof Error ? err.message : String(err) });
    }

    if (this.options.supabaseSync !== null) {
      try {
        await this.options.supabaseSync.syncCycleFromDailyInput(this.options.pair, input);
        this.options.logger.info("Supabase behavior cycle synced", { pair: this.options.pair });
      } catch (err) {
        this.options.logger.error("Supabase behavior sync failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private buildInput(state: CycleState): DailyCycleInput {
    const sorted = this.getSortedCandles(state);
    return {
      cycleStartUtcMs: state.cycleStartUtcMs,
      allCandles15m: sorted,
      candles4h: state.candles4h,
      pdh: state.pdh,
      pdl: state.pdl,
      uid: state.uid,
      writeDate: toDateString(Date.now()),
    };
  }

  private getSortedCandles(state: CycleState): readonly Candle[] {
    return [...state.candlesByTime.values()].sort((a, b) => a.timeUtcMs - b.timeUtcMs);
  }

  private async runIncrementalAnalysis(): Promise<void> {
    const analyzer = new BehaviorAnalyzer();
    const input = this.buildInput(this.activeState);
    const row = analyzer.analyze(input);

    const hasDecisionConfirmed = row.decisionConfirmTime !== "N/A" && row.decisionConfirmTime !== "";
    if (hasDecisionConfirmed && !this.activeState.decisionAlertSent && this.options.telegramAlerter) {
      await this.options.telegramAlerter.sendAlert({
        level: "INFO",
        message: `⚡ <b>Decision Alert</b>\n\nLevel: ${row.previousDayLevel}\nBehavior: ${row.twoCandleBehavior}\nConfirmed Output: ${row.decisionOutput}`,
        botId: "BehaviorBot"
      });
      this.activeState.decisionAlertSent = true;
    }

    const hasOutcomeBegin = row.resolvedOutcomeBeginTime !== "N/A" && row.resolvedOutcomeBeginTime !== "";
    if (hasDecisionConfirmed && hasOutcomeBegin && !this.activeState.outcomeAlertSent && this.options.telegramAlerter) {
      await this.options.telegramAlerter.sendAlert({
        level: "INFO",
        message: `🚀 <b>Outcome Begun</b>\n\nExpected Direction: ${row.resolvedOutcomeDirection}`,
        botId: "BehaviorBot"
      });
      this.activeState.outcomeAlertSent = true;
    }
  }

  private handleError(error: ExchangeError): void {
    this.options.logger.error("Candle subscription error", { message: error.message });

    setTimeout(() => {
      this.start().catch((err) => {
        this.reconnectCount++;
        if (this.reconnectCount === 3 && this.options.telegramAlerter) {
          this.options.telegramAlerter.sendAlert({
            level: "CRITICAL",
            message: `BehaviorBot failed to reconnect after 3 attempts. Rescheduled: ${err instanceof Error ? err.message : String(err)}`,
            botId: "BehaviorBot"
          }).catch(console.error);
        }
        // keep retrying
        this.handleError(new ExchangeError({ code: "NETWORK_ERROR", message: "Retry failed" }));
      });
    }, 5000);
  }
}
