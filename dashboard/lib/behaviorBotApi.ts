/**
 * Server-only: calls the Node bot HTTP API (isolated-vm) with shared secret.
 */

export type BehaviorBotEnv = Readonly<{
  baseUrl: string;
  secret: string;
}>;

/**
 * Reads dashboard server env for Phase 5 behavior runner proxy.
 */
export function getBehaviorBotEnv(): BehaviorBotEnv | null {
  const baseUrl =
    typeof process.env["BEHAVIOR_API_BASE_URL"] === "string"
      ? process.env["BEHAVIOR_API_BASE_URL"].trim().replace(/\/$/, "")
      : "";
  const secret =
    typeof process.env["BEHAVIOR_API_SECRET"] === "string" ? process.env["BEHAVIOR_API_SECRET"].trim() : "";
  if (baseUrl.length === 0 || secret.length === 0) {
    return null;
  }
  return { baseUrl, secret };
}

/**
 * POST JSON to bot `/behavior/*` with Bearer auth.
 */
export async function postBehaviorBotJson(
  env: BehaviorBotEnv,
  path: "/behavior/test-run" | "/behavior/reanalyze-ruleset" | "/behavior/run-backtest",
  body: Record<string, unknown>
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; message: string }> {
  const url = `${env.baseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${env.secret}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  } catch {
    return { ok: false, status: res.status, message: text.slice(0, 500) };
  }

  if (!res.ok) {
    const msg =
      isRecord(parsed) && typeof parsed["error"] === "string"
        ? parsed["error"]
        : `HTTP ${String(res.status)}`;
    return { ok: false, status: res.status, message: msg };
  }

  return { ok: true, json: parsed };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
