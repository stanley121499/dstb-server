import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const BodySchema = z.object({
  natural_language: z.string().min(1).max(16_000),
  existing_code: z.string().max(200_000).optional(),
  slug: z.string().max(200).optional()
});

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-3-5-haiku-20241022";

async function loadPromptContract(): Promise<string> {
  const filePath = path.join(process.cwd(), "public", "behavior-analyzer-prompt.md");
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "You generate sandboxed JavaScript analyzer code for DSTB. Output JSON only with key \"code\" containing the full module source.";
  }
}

type OpenAIChatResponse = Readonly<{
  choices?: ReadonlyArray<Readonly<{ message?: Readonly<{ content?: string }> }>>;
}>;

type AnthropicResponse = Readonly<{
  content?: ReadonlyArray<Readonly<{ type?: string; text?: string }>>;
}>;

function extractJsonCode(raw: string): { ok: true; code: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed) as unknown;
  } catch {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence !== null && fence[1] !== undefined) {
      try {
        obj = JSON.parse(fence[1].trim()) as unknown;
      } catch {
        return { ok: false, error: "Model returned invalid JSON." };
      }
    } else {
      return { ok: false, error: "Model did not return valid JSON with a code field." };
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, error: "Expected JSON object from model." };
  }
  const code = (obj as Record<string, unknown>)["code"];
  if (typeof code !== "string" || code.length === 0) {
    return { ok: false, error: "JSON must include non-empty string field \"code\"." };
  }
  return { ok: true, code };
}

async function callOpenAI(args: Readonly<{ apiKey: string; system: string; user: string }>): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user }
      ]
    })
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${String(res.status)}: ${text.slice(0, 400)}`);
  }
  let parsed: OpenAIChatResponse;
  try {
    parsed = JSON.parse(text) as OpenAIChatResponse;
  } catch {
    throw new Error("OpenAI response was not JSON.");
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenAI returned no message content.");
  }
  return content;
}

async function callAnthropic(args: Readonly<{ apiKey: string; system: string; user: string }>): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      temperature: 0.2,
      system: args.system,
      messages: [{ role: "user", content: args.user }]
    })
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${String(res.status)}: ${text.slice(0, 400)}`);
  }
  let parsed: AnthropicResponse;
  try {
    parsed = JSON.parse(text) as AnthropicResponse;
  } catch {
    throw new Error("Anthropic response was not JSON.");
  }
  const block = parsed.content?.find((b) => b.type === "text");
  if (block === undefined || typeof block.text !== "string") {
    throw new Error("Anthropic returned no text block.");
  }
  return block.text;
}

/**
 * Server-only LLM proxy: returns `{ code }` for the analyzer editor. Requires OPENAI_API_KEY or ANTHROPIC_API_KEY.
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

  const openaiKey =
    typeof process.env["OPENAI_API_KEY"] === "string" ? process.env["OPENAI_API_KEY"].trim() : "";
  const anthropicKey =
    typeof process.env["ANTHROPIC_API_KEY"] === "string" ? process.env["ANTHROPIC_API_KEY"].trim() : "";

  if (openaiKey.length === 0 && anthropicKey.length === 0) {
    return NextResponse.json(
      { error: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY on the dashboard server (never NEXT_PUBLIC_*)" },
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

  const contract = await loadPromptContract();
  const system = [
    "You are a senior quant developer. Follow the analyzer contract below exactly.",
    "Respond with a single JSON object only, no markdown outside JSON, shape: {\"code\": \"...full JavaScript source...\"}.",
    "The code must be valid for execution in an isolated-vm sandbox as described in the contract.",
    "--- CONTRACT ---",
    contract
  ].join("\n");

  const userParts = [
    `Analyzer slug hint: ${parsed.data.slug ?? "(none)"}`,
    "",
    "User rules / natural language spec:",
    parsed.data.natural_language
  ];
  if (parsed.data.existing_code !== undefined && parsed.data.existing_code.length > 0) {
    userParts.push("", "Existing code to improve or replace:", parsed.data.existing_code);
  }
  const userMsg = userParts.join("\n");

  try {
    const raw =
      openaiKey.length > 0
        ? await callOpenAI({ apiKey: openaiKey, system, user: userMsg })
        : await callAnthropic({ apiKey: anthropicKey, system, user: userMsg });

    const extracted = extractJsonCode(raw);
    if (!extracted.ok) {
      return NextResponse.json({ error: extracted.error, raw_preview: raw.slice(0, 800) }, { status: 502 });
    }
    return NextResponse.json({ ok: true, code: extracted.code });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
