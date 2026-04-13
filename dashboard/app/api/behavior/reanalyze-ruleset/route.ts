import { NextResponse } from "next/server";
import { z } from "zod";

import { getBehaviorBotEnv, postBehaviorBotJson } from "@/lib/behaviorBotApi";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BodySchema = z.object({
  ruleset_id: z.string().uuid(),
  symbol: z.string().min(1).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  batch_size: z.number().int().positive().max(500).optional(),
});

/**
 * Authenticated proxy to bot server POST /behavior/reanalyze-ruleset.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr !== null || user === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = getBehaviorBotEnv();
  if (env === null) {
    return NextResponse.json(
      { error: "Behavior runner not configured (BEHAVIOR_API_BASE_URL / BEHAVIOR_API_SECRET)" },
      { status: 503 }
    );
  }

  let json: unknown;
  try {
    json = (await req.json()) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const body: Record<string, unknown> = {
    ruleset_id: parsed.data.ruleset_id,
  };
  if (parsed.data.symbol !== undefined) {
    body["symbol"] = parsed.data.symbol;
  }
  if (parsed.data.from !== undefined) {
    body["from"] = parsed.data.from;
  }
  if (parsed.data.to !== undefined) {
    body["to"] = parsed.data.to;
  }
  if (parsed.data.batch_size !== undefined) {
    body["batch_size"] = parsed.data.batch_size;
  }

  const out = await postBehaviorBotJson(env, "/behavior/reanalyze-ruleset", body);
  if (!out.ok) {
    return NextResponse.json({ error: out.message }, { status: out.status >= 400 ? out.status : 502 });
  }

  return NextResponse.json(out.json);
}
