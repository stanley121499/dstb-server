import { NextResponse } from "next/server";
import { z } from "zod";

import { getBehaviorBotEnv, postBehaviorBotJson } from "@/lib/behaviorBotApi";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BodySchema = z.object({
  raw_cycle_id: z.string().uuid(),
  analyzer_id: z.string().uuid().optional(),
  code_override: z.string().optional(),
  draft_sandbox_code: z.string().optional(),
  execution_mode_override: z.enum(["sandbox", "native_s2"]).optional(),
  params_override: z.record(z.unknown()).optional(),
  mark_tested: z.boolean().optional(),
});

/**
 * Authenticated proxy to bot server POST /behavior/test-run.
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
    raw_cycle_id: parsed.data.raw_cycle_id,
  };
  if (parsed.data.analyzer_id !== undefined) {
    body["analyzer_id"] = parsed.data.analyzer_id;
  }
  if (parsed.data.code_override !== undefined) {
    body["code_override"] = parsed.data.code_override;
  }
  if (parsed.data.draft_sandbox_code !== undefined) {
    body["draft_sandbox_code"] = parsed.data.draft_sandbox_code;
  }
  if (parsed.data.execution_mode_override !== undefined) {
    body["execution_mode_override"] = parsed.data.execution_mode_override;
  }
  if (parsed.data.params_override !== undefined) {
    body["params_override"] = parsed.data.params_override;
  }
  if (parsed.data.mark_tested === true) {
    body["mark_tested"] = true;
  }

  const out = await postBehaviorBotJson(env, "/behavior/test-run", body);
  if (!out.ok) {
    return NextResponse.json({ error: out.message }, { status: out.status >= 400 ? out.status : 502 });
  }

  return NextResponse.json(out.json);
}
