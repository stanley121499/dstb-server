import { NextResponse } from "next/server";
import { z } from "zod";

import { getBehaviorBotEnv, postBehaviorBotJson } from "@/lib/behaviorBotApi";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BodySchema = z.object({
  environment_id: z.string().uuid(),
  start: z.string().min(8),
  end: z.string().min(8)
});

/**
 * Authenticated proxy to bot server POST /behavior/run-backtest.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr
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

  const out = await postBehaviorBotJson(env, "/behavior/run-backtest", {
    environment_id: parsed.data.environment_id,
    start: parsed.data.start,
    end: parsed.data.end
  });

  if (!out.ok) {
    return NextResponse.json({ error: out.message }, { status: out.status >= 400 ? out.status : 502 });
  }

  return NextResponse.json(out.json);
}
