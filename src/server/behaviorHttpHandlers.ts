import type http from "node:http";

import type { Logger } from "../core/Logger.js";
import type { SupabaseStateStore } from "../core/SupabaseStateStore.js";
import { BehaviorSupabaseSync } from "../behavior/supabase/behaviorSupabaseSync.js";
import { runBacktestWithYahoo } from "../backtest/runBacktestWithYahoo.js";

/**
 * Reads and parses JSON body (max ~2MB) from an HTTP request.
 */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const max = 2 * 1024 * 1024;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > max) {
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (raw.trim().length === 0) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw) as unknown);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on("error", reject);
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function readBool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === "boolean" ? v : undefined;
}

function readStringRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = obj[key];
  if (!isRecord(v)) {
    return undefined;
  }
  return v;
}

type DerivedBacktestFields = Readonly<{
  strategy: string;
  symbol: string;
  interval: string;
  initialBalance: number;
  paramsBody: Record<string, unknown>;
}>;

/** Exported for unit tests — maps `behavior_environments.derived_params` to Yahoo backtest inputs. */
export function parseDerivedParamsForBacktest(
  raw: unknown
): { ok: true } & DerivedBacktestFields | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: "derived_params must be a JSON object" };
  }
  const strategy = raw["strategy"];
  const symbol = raw["symbol"];
  const interval = raw["interval"];
  const initialRaw = raw["initial_balance"];
  const params = raw["params"];

  if (typeof strategy !== "string" || strategy.length === 0) {
    return { ok: false, error: "derived_params.strategy is required" };
  }
  if (typeof symbol !== "string" || symbol.length === 0) {
    return { ok: false, error: "derived_params.symbol is required" };
  }
  if (typeof interval !== "string" || interval.length === 0) {
    return { ok: false, error: "derived_params.interval is required" };
  }
  const initialBalance = typeof initialRaw === "number" ? initialRaw : Number(initialRaw);
  if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
    return { ok: false, error: "derived_params.initial_balance must be a positive number" };
  }
  if (!isRecord(params)) {
    return { ok: false, error: "derived_params.params must be an object" };
  }

  return {
    ok: true,
    strategy,
    symbol,
    interval,
    initialBalance,
    paramsBody: params
  };
}

/**
 * Validates `Authorization: Bearer <secret>` or `X-Behavior-Api-Key: <secret>`.
 */
export function behaviorApiAuthorized(req: http.IncomingMessage, secret: string): boolean {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    return token === secret && secret.length > 0;
  }
  const key = req.headers["x-behavior-api-key"];
  if (typeof key === "string" && key === secret && secret.length > 0) {
    return true;
  }
  return false;
}

export type BehaviorHttpContext = Readonly<{
  store: SupabaseStateStore;
  logger: Logger;
  behaviorApiSecret: string;
}>;

/**
 * Handles POST /behavior/test-run and POST /behavior/reanalyze-ruleset.
 * Returns true if handled (caller should not send 404).
 */
export async function tryHandleBehaviorApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: BehaviorHttpContext
): Promise<boolean> {
  const url = req.url ?? "";
  if (req.method !== "POST") {
    return false;
  }

  if (
    url !== "/behavior/test-run" &&
    url !== "/behavior/reanalyze-ruleset" &&
    url !== "/behavior/run-backtest"
  ) {
    return false;
  }

  if (ctx.behaviorApiSecret.length === 0) {
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "BEHAVIOR_API_SECRET is not configured" }));
    return true;
  }

  if (!behaviorApiAuthorized(req, ctx.behaviorApiSecret)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return true;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return true;
  }

  if (!isRecord(body)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Body must be a JSON object" }));
    return true;
  }

  const sync = new BehaviorSupabaseSync(ctx.store.client, ctx.logger);

  try {
    if (url === "/behavior/run-backtest") {
      const environmentId = readString(body, "environment_id");
      const start = readString(body, "start");
      const end = readString(body, "end");
      if (environmentId === undefined || environmentId.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "environment_id is required" }));
        return true;
      }
      if (start === undefined || start.length === 0 || end === undefined || end.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "start and end are required (YYYY-MM-DD)" }));
        return true;
      }

      const { data: envRow, error: envErr } = await ctx.store.client
        .from("behavior_environments")
        .select("id, derived_params")
        .eq("id", environmentId)
        .maybeSingle();

      if (envErr !== null) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: envErr.message }));
        return true;
      }
      if (envRow === null) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "environment not found" }));
        return true;
      }

      const derivedRaw = (envRow as { derived_params?: unknown }).derived_params;
      const parsedDerived = parseDerivedParamsForBacktest(derivedRaw);
      if (!parsedDerived.ok) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: parsedDerived.error }));
        return true;
      }

      const bt = await runBacktestWithYahoo({
        strategy: parsedDerived.strategy,
        symbol: parsedDerived.symbol,
        interval: parsedDerived.interval,
        initialBalance: parsedDerived.initialBalance,
        paramsBody: parsedDerived.paramsBody,
        startDate: start,
        endDate: end
      });

      if (!bt.ok) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: bt.error }));
        return true;
      }

      const maxTrades = 500;
      const maxEquity = 2000;
      const tradesOut = bt.result.trades.slice(0, maxTrades).map((t) => ({ ...t }));
      const eq = bt.result.equityPoints;
      const equitySample =
        eq.length <= maxEquity ? eq : [...eq.slice(0, maxEquity / 2), ...eq.slice(-maxEquity / 2)];

      const backtestStats = {
        run_at: new Date().toISOString(),
        run_id: bt.runId,
        period: { start, end },
        metrics: bt.result.metrics,
        trades: tradesOut,
        trades_truncated: bt.result.trades.length > maxTrades,
        equity_points: equitySample,
        equity_truncated: eq.length > equitySample.length,
        engine_warnings: bt.result.warnings,
        candle_warnings: [...bt.candleWarnings]
      };

      const { error: upErr } = await ctx.store.client
        .from("behavior_environments")
        .update({ backtest_stats: backtestStats })
        .eq("id", environmentId);

      if (upErr !== null) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: upErr.message }));
        return true;
      }

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          metrics: bt.result.metrics,
          trade_count: bt.result.trades.length,
          run_id: bt.runId
        })
      );
      return true;
    }

    if (url === "/behavior/test-run") {
      const rawCycleId = readString(body, "raw_cycle_id");
      if (rawCycleId === undefined || rawCycleId.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "raw_cycle_id is required" }));
        return true;
      }
      const analyzerId = readString(body, "analyzer_id");
      const codeOverride = readString(body, "code_override");
      const draftSandboxCode = readString(body, "draft_sandbox_code");
      const executionModeOverride = readString(body, "execution_mode_override");
      const paramsOverride = readStringRecord(body, "params_override");
      const markTested = readBool(body, "mark_tested") ?? false;

      const result = await sync.testRunAnalyzer({
        rawCycleId,
        ...(analyzerId !== undefined && analyzerId.length > 0 ? { analyzerId } : {}),
        ...(codeOverride !== undefined ? { codeOverride } : {}),
        ...(draftSandboxCode !== undefined ? { draftSandboxCode } : {}),
        ...(executionModeOverride !== undefined ? { executionModeOverride } : {}),
        ...(paramsOverride !== undefined ? { paramsOverride } : {}),
        markTested,
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, result }));
      return true;
    }

    const rulesetId = readString(body, "ruleset_id");
    if (rulesetId === undefined || rulesetId.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "ruleset_id is required" }));
      return true;
    }
    const symbol = readString(body, "symbol");
    const from = readString(body, "from");
    const to = readString(body, "to");
    const batchRaw = body["batch_size"];
    const batchSize = typeof batchRaw === "number" && Number.isFinite(batchRaw) ? Math.floor(batchRaw) : undefined;

    const out = await sync.reanalyzeRulesetForAllCycles({
      rulesetId,
      ...(symbol !== undefined && symbol.length > 0 ? { symbol } : {}),
      ...(from !== undefined && from.length > 0 ? { from } : {}),
      ...(to !== undefined && to.length > 0 ? { to } : {}),
      ...(batchSize !== undefined && batchSize > 0 ? { batchSize } : {}),
    });

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, processed: out.processed, total_cycles: out.totalCycles }));
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.warn(`Behavior API error: ${msg}`, { event: "behavior_api_error", path: url });
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: msg }));
    return true;
  }
}
