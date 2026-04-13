import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Logger } from "../../core/Logger.js";
import type { Candle, DailyCycleInput } from "../types.js";
import { SandboxedAnalyzerRunner } from "../sandbox/SandboxedAnalyzerRunner.js";
import { runNativeS2Analyzer } from "../sandbox/nativeS2Analyzer.js";
import { dailyCycleInputFromRawCycleRow, type RawCycleRowForInput } from "./rawCycleToDailyInput.js";

const RulesetAnalyzerEntrySchema = z.object({
  analyzer_id: z.string().uuid(),
  params: z.record(z.unknown()).optional().default({}),
});

export const RulesetAnalyzersSchema = z.array(RulesetAnalyzerEntrySchema);

export type BehaviorAnalyzerRow = Readonly<{
  id: string;
  slug: string;
  code: string;
  execution_mode: string;
  param_defaults: Record<string, unknown>;
  version: number;
}>;

export type ActiveBehaviorRuleset = Readonly<{
  id: string;
  entries: z.infer<typeof RulesetAnalyzersSchema>;
}>;

function cycleDateUtcFromMs(cycleStartUtcMs: number): string {
  return new Date(cycleStartUtcMs).toISOString().slice(0, 10);
}

function toSandboxCandleArray(candles: readonly Candle[]): ReadonlyArray<Record<string, number>> {
  return candles.map((c) => ({
    t: c.timeUtcMs,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
  }));
}

function sessionOpenFromInput(input: DailyCycleInput): number {
  const atStart = input.allCandles15m.find((c) => c.timeUtcMs >= input.cycleStartUtcMs);
  if (atStart === undefined) {
    return 0;
  }
  return atStart.open;
}

export function buildSandboxInputSnapshot(input: DailyCycleInput): Readonly<{
  candles: Record<string, readonly unknown[]>;
  referenceLevels: Record<string, number>;
}> {
  return {
    candles: {
      "15m": toSandboxCandleArray(input.allCandles15m),
      "4h": toSandboxCandleArray(input.candles4h),
    },
    referenceLevels: {
      pdh: input.pdh,
      pdl: input.pdl,
      sessionOpen: sessionOpenFromInput(input),
    },
  };
}

/**
 * Persists one daily behavior cycle to Supabase and runs the active ruleset analyzers.
 */
export class BehaviorSupabaseSync {
  private readonly runner: SandboxedAnalyzerRunner;

  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger | null = null
  ) {
    this.runner = new SandboxedAnalyzerRunner();
  }

  /**
   * Upserts `behavior_raw_cycles` and `behavior_results` for the given symbol and cycle input.
   */
  async syncCycleFromDailyInput(symbol: string, input: DailyCycleInput): Promise<void> {
    const cycleDate = cycleDateUtcFromMs(input.cycleStartUtcMs);
    const snap = buildSandboxInputSnapshot(input);
    const candlesPayload: Record<string, unknown> = {
      "15m": snap.candles["15m"],
      "4h": snap.candles["4h"],
    };
    const referenceLevelsPayload: Record<string, number> = { ...snap.referenceLevels };

    const { data: rawRow, error: rawErr } = await this.client
      .from("behavior_raw_cycles")
      .upsert(
        {
          symbol,
          cycle_date: cycleDate,
          candles: candlesPayload,
          reference_levels: referenceLevelsPayload,
          metadata: { uid: input.uid, writeDate: input.writeDate },
        },
        { onConflict: "symbol,cycle_date" }
      )
      .select("id")
      .single();

    if (rawErr !== null) {
      throw new Error(`behavior_raw_cycles upsert: ${rawErr.message}`);
    }
    if (rawRow === null || typeof rawRow !== "object") {
      throw new Error("behavior_raw_cycles upsert returned no row");
    }
    const rid = (rawRow as Record<string, unknown>)["id"];
    if (typeof rid !== "string") {
      throw new Error("behavior_raw_cycles upsert missing id");
    }

    const ruleset = await this.fetchActiveRuleset();
    if (ruleset === null) {
      this.logger?.warn("No active behavior_rulesets row; skipping behavior_results", { symbol, cycleDate });
      return;
    }

    const analyzerById = await this.fetchAnalyzersByIds(ruleset.entries.map((e) => e.analyzer_id));
    const merged = await this.runRulesetAnalyzers(ruleset.entries, analyzerById, input, snap);

    const { error: resErr } = await this.client.from("behavior_results").upsert(
      {
        raw_cycle_id: rid,
        ruleset_id: ruleset.id,
        columns: merged.columns,
        details: merged.details,
      },
      { onConflict: "raw_cycle_id,ruleset_id" }
    );

    if (resErr !== null) {
      throw new Error(`behavior_results upsert: ${resErr.message}`);
    }
  }

  async fetchActiveRuleset(): Promise<ActiveBehaviorRuleset | null> {
    const { data, error } = await this.client
      .from("behavior_rulesets")
      .select("id, analyzers")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error !== null) {
      throw new Error(`behavior_rulesets: ${error.message}`);
    }
    if (data === null) {
      return null;
    }
    return this.parseRulesetRow(data as Record<string, unknown>);
  }

  /**
   * Load a ruleset by primary key (Phase 5 re-analysis and dashboard).
   */
  async fetchRulesetById(rulesetId: string): Promise<ActiveBehaviorRuleset | null> {
    const { data, error } = await this.client
      .from("behavior_rulesets")
      .select("id, analyzers")
      .eq("id", rulesetId)
      .maybeSingle();

    if (error !== null) {
      throw new Error(`behavior_rulesets: ${error.message}`);
    }
    if (data === null) {
      return null;
    }
    return this.parseRulesetRow(data as Record<string, unknown>);
  }

  private parseRulesetRow(row: Record<string, unknown>): ActiveBehaviorRuleset | null {
    const id = row["id"];
    const analyzersJson = row["analyzers"];
    if (typeof id !== "string") {
      return null;
    }
    const parsed = RulesetAnalyzersSchema.safeParse(analyzersJson);
    if (!parsed.success) {
      throw new Error(`Invalid analyzers JSON on ruleset ${id}`);
    }
    return { id, entries: parsed.data };
  }

  /**
   * Phase 5 — run one analyzer against a stored raw cycle (test run).
   * With `analyzerId`: loads DB row; `codeOverride` replaces sandbox code for unsaved edits.
   * Without `analyzerId`: requires `draftSandboxCode` + `execution_mode` `sandbox` only (no `markTested`).
   */
  async testRunAnalyzer(args: Readonly<{
    rawCycleId: string;
    analyzerId?: string;
    codeOverride?: string;
    draftSandboxCode?: string;
    executionModeOverride?: string;
    paramsOverride?: Record<string, unknown>;
    markTested?: boolean;
  }>): Promise<
    | Readonly<{ mode: "sandbox"; label: string; details: Record<string, unknown> }>
    | Readonly<{ mode: "native_s2"; columns: Record<string, string>; details: Record<string, unknown> }>
  > {
    const { data: rawRow, error: rawErr } = await this.client
      .from("behavior_raw_cycles")
      .select("id, cycle_date, candles, reference_levels, metadata")
      .eq("id", args.rawCycleId)
      .maybeSingle();

    if (rawErr !== null) {
      throw new Error(`behavior_raw_cycles: ${rawErr.message}`);
    }
    if (rawRow === null) {
      throw new Error("Raw cycle not found");
    }

    const row = rawRow as RawCycleRowForInput;
    const input = dailyCycleInputFromRawCycleRow(row);
    const snap = buildSandboxInputSnapshot(input);

    let code: string;
    let executionMode: string;
    let mergedParams: Record<string, unknown>;

    const hasAnalyzer = typeof args.analyzerId === "string" && args.analyzerId.length > 0;

    if (!hasAnalyzer) {
      const draft = args.draftSandboxCode;
      if (typeof draft !== "string" || draft.trim().length === 0) {
        throw new Error("Either analyzerId or draftSandboxCode is required");
      }
      const em = args.executionModeOverride ?? "sandbox";
      if (em !== "sandbox") {
        throw new Error("Draft test run only supports execution_mode sandbox");
      }
      if (args.markTested === true) {
        throw new Error("markTested requires analyzerId");
      }
      code = draft;
      executionMode = "sandbox";
      mergedParams = { ...(args.paramsOverride ?? {}) };
    } else {
      const { data: anRow, error: anErr } = await this.client
        .from("behavior_analyzers")
        .select("id, slug, code, execution_mode, param_defaults, version")
        .eq("id", args.analyzerId)
        .maybeSingle();

      if (anErr !== null) {
        throw new Error(`behavior_analyzers: ${anErr.message}`);
      }
      if (anRow === null) {
        throw new Error("Analyzer not found");
      }

      const ar = anRow as Record<string, unknown>;
      const codeDb = ar["code"];
      const executionModeDb = ar["execution_mode"];
      const paramDefaults = ar["param_defaults"];
      const version = ar["version"];
      if (typeof codeDb !== "string" || typeof executionModeDb !== "string" || typeof version !== "number") {
        throw new Error("Invalid analyzer row shape");
      }
      const pd =
        typeof paramDefaults === "object" && paramDefaults !== null && !Array.isArray(paramDefaults)
          ? (paramDefaults as Record<string, unknown>)
          : {};

      code = typeof args.codeOverride === "string" && args.codeOverride.length > 0 ? args.codeOverride : codeDb;
      executionMode =
        typeof args.executionModeOverride === "string" && args.executionModeOverride.length > 0
          ? args.executionModeOverride
          : executionModeDb;

      mergedParams = {
        ...pd,
        ...(args.paramsOverride ?? {}),
      };
    }

    if (executionMode === "native_s2") {
      const out = runNativeS2Analyzer(input);
      if (args.markTested === true && hasAnalyzer && args.analyzerId !== undefined) {
        await this.client.from("behavior_analyzers").update({ tested: true }).eq("id", args.analyzerId);
      }
      return { mode: "native_s2", columns: out.columns, details: out.details };
    }

    if (executionMode !== "sandbox") {
      throw new Error(`Unsupported execution_mode: ${executionMode}`);
    }

    const sandboxInput = {
      candles: snap.candles,
      referenceLevels: snap.referenceLevels,
      params: mergedParams,
    };
    const out = await this.runner.runAnalyzerCode(code, sandboxInput);
    if (args.markTested === true && hasAnalyzer && args.analyzerId !== undefined) {
      await this.client.from("behavior_analyzers").update({ tested: true }).eq("id", args.analyzerId);
    }
    return { mode: "sandbox", label: out.label, details: out.details };
  }

  /**
   * Phase 5 — re-run all analyzers in a ruleset for each matching raw cycle; upserts `behavior_results`.
   */
  async reanalyzeRulesetForAllCycles(args: Readonly<{
    rulesetId: string;
    symbol?: string;
    from?: string;
    to?: string;
    batchSize?: number;
  }>): Promise<{ processed: number; totalCycles: number }> {
    const ruleset = await this.fetchRulesetById(args.rulesetId);
    if (ruleset === null) {
      throw new Error("Ruleset not found");
    }

    const analyzerById = await this.fetchAnalyzersByIds(ruleset.entries.map((e) => e.analyzer_id));
    if (analyzerById.size === 0) {
      throw new Error("Ruleset has no resolvable analyzers");
    }

    let q = this.client
      .from("behavior_raw_cycles")
      .select("id, cycle_date, candles, reference_levels, metadata", { count: "exact" })
      .order("cycle_date", { ascending: true });

    if (typeof args.symbol === "string" && args.symbol.length > 0) {
      q = q.eq("symbol", args.symbol);
    }
    if (typeof args.from === "string" && args.from.length > 0) {
      q = q.gte("cycle_date", args.from);
    }
    if (typeof args.to === "string" && args.to.length > 0) {
      q = q.lte("cycle_date", args.to);
    }

    const batchSize = args.batchSize ?? 100;
    let processed = 0;
    let offset = 0;

    let countQuery = this.client.from("behavior_raw_cycles").select("id", { count: "exact", head: true });
    if (typeof args.symbol === "string" && args.symbol.length > 0) {
      countQuery = countQuery.eq("symbol", args.symbol);
    }
    if (typeof args.from === "string" && args.from.length > 0) {
      countQuery = countQuery.gte("cycle_date", args.from);
    }
    if (typeof args.to === "string" && args.to.length > 0) {
      countQuery = countQuery.lte("cycle_date", args.to);
    }
    const { count: totalCount, error: countErr } = await countQuery;
    if (countErr !== null) {
      throw new Error(`behavior_raw_cycles count: ${countErr.message}`);
    }
    const totalCycles = typeof totalCount === "number" ? totalCount : 0;

    for (;;) {
      const { data: page, error: pageErr } = await q.range(offset, offset + batchSize - 1);
      if (pageErr !== null) {
        throw new Error(`behavior_raw_cycles page: ${pageErr.message}`);
      }
      const rows = page ?? [];
      if (rows.length === 0) {
        break;
      }

      for (const raw of rows) {
        const r = raw as Record<string, unknown>;
        const rid = r["id"];
        if (typeof rid !== "string") {
          continue;
        }
        const input = dailyCycleInputFromRawCycleRow({
          cycle_date: String(r["cycle_date"]),
          candles: r["candles"],
          reference_levels: r["reference_levels"],
          metadata: r["metadata"],
        });
        const snap = buildSandboxInputSnapshot(input);
        const merged = await this.runRulesetAnalyzers(ruleset.entries, analyzerById, input, snap);

        const { error: resErr } = await this.client.from("behavior_results").upsert(
          {
            raw_cycle_id: rid,
            ruleset_id: ruleset.id,
            columns: merged.columns,
            details: merged.details,
          },
          { onConflict: "raw_cycle_id,ruleset_id" }
        );

        if (resErr !== null) {
          throw new Error(`behavior_results upsert: ${resErr.message}`);
        }
        processed += 1;
      }

      offset += rows.length;
      if (rows.length < batchSize) {
        break;
      }
    }

    return { processed, totalCycles };
  }

  private async fetchAnalyzersByIds(ids: readonly string[]): Promise<Map<string, BehaviorAnalyzerRow>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from("behavior_analyzers")
      .select("id, slug, code, execution_mode, param_defaults, version")
      .in("id", unique);

    if (error !== null) {
      throw new Error(`behavior_analyzers: ${error.message}`);
    }

    const map = new Map<string, BehaviorAnalyzerRow>();
    for (const raw of data ?? []) {
      const r = raw as Record<string, unknown>;
      const id = r["id"];
      const slug = r["slug"];
      const code = r["code"];
      const execution_mode = r["execution_mode"];
      const param_defaults = r["param_defaults"];
      const version = r["version"];
      if (
        typeof id !== "string" ||
        typeof slug !== "string" ||
        typeof code !== "string" ||
        typeof execution_mode !== "string" ||
        typeof version !== "number"
      ) {
        continue;
      }
      const pd =
        typeof param_defaults === "object" && param_defaults !== null && !Array.isArray(param_defaults)
          ? (param_defaults as Record<string, unknown>)
          : {};
      map.set(id, { id, slug, code, execution_mode, param_defaults: pd, version });
    }
    return map;
  }

  private async runRulesetAnalyzers(
    entries: z.infer<typeof RulesetAnalyzersSchema>,
    analyzerById: Map<string, BehaviorAnalyzerRow>,
    input: DailyCycleInput,
    snap: ReturnType<typeof buildSandboxInputSnapshot>
  ): Promise<{ columns: Record<string, string>; details: Record<string, unknown> }> {
    const columns: Record<string, string> = {};
    const details: Record<string, unknown> = {};

    for (const entry of entries) {
      const a = analyzerById.get(entry.analyzer_id);
      if (a === undefined) {
        continue;
      }
      const mergedParams: Record<string, unknown> = {
        ...a.param_defaults,
        ...entry.params,
      };

      if (a.execution_mode === "native_s2") {
        const out = runNativeS2Analyzer(input);
        Object.assign(columns, out.columns);
        details[a.slug] = out.details;
        continue;
      }

      const sandboxInput = {
        candles: snap.candles,
        referenceLevels: snap.referenceLevels,
        params: mergedParams,
      };
      const out = await this.runner.runAnalyzerCode(a.code, sandboxInput);
      columns[a.slug] = out.label;
      details[a.slug] = out.details;
    }

    return { columns, details };
  }
}
