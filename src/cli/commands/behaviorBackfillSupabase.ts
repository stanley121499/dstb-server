import type { ParsedCliArgs } from "./cliTypes.js";
import { createServiceRoleClient } from "../../supabase/client.js";
import { loadSupabaseEnv } from "../../supabase/env.js";
import { BehaviorSupabaseSync } from "../../behavior/supabase/behaviorSupabaseSync.js";
import {
  loadBehaviorDailyCycleInputsForRange,
  readBehaviorBacktestRangeFromEnv,
} from "../../behavior/scripts/behaviorBacktestData.js";
import { toDateString } from "../../behavior/utils.js";

/**
 * Fetches historical candles and upserts behavior_raw_cycles + behavior_results in Supabase.
 * Uses BEHAVIOR_BACKTEST_START, BEHAVIOR_BACKTEST_END, BEHAVIOR_PAIR and Supabase service role env.
 */
export async function runBehaviorBackfillSupabase(args: ParsedCliArgs): Promise<void> {
  void args;
  const range = readBehaviorBacktestRangeFromEnv();
  const env = loadSupabaseEnv();
  const client = createServiceRoleClient(env);
  const sync = new BehaviorSupabaseSync(client, null);

  const cycles = await loadBehaviorDailyCycleInputsForRange(range);
  console.log(`[behavior:backfill-supabase] Loaded ${cycles.length} cycles for ${range.pair} (${range.backtestStart} → ${range.backtestEnd})`);

  let ok = 0;
  for (const input of cycles) {
    await sync.syncCycleFromDailyInput(range.pair, input);
    ok += 1;
    if (ok % 50 === 0) {
      console.log(`[behavior:backfill-supabase] Upserted ${ok} / ${cycles.length} (${toDateString(input.cycleStartUtcMs)})`);
    }
  }

  console.log(`[behavior:backfill-supabase] Done. Upserted ${ok} cycles.`);
}

export const runBehaviorBackfillSupabaseCommand = runBehaviorBackfillSupabase;
