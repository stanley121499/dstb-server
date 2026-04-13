import ivm from "isolated-vm";
import {
  findFirstInteraction,
  getCandlePosition,
  getCandlesInWindow,
  hasWickTouch,
} from "./behaviorSandboxHelpers.js";

export type SandboxAnalyzerInputSnapshot = Readonly<{
  candles: Record<string, readonly unknown[]>;
  referenceLevels: Record<string, number>;
  params: Record<string, unknown>;
}>;

export type SandboxRunResult = Readonly<{
  label: string;
  details: Record<string, unknown>;
}>;

export type SandboxedAnalyzerRunnerOptions = Readonly<{
  timeoutMs: number;
  memoryMb: number;
}>;

const DEFAULT_OPTIONS: SandboxedAnalyzerRunnerOptions = {
  timeoutMs: 5000,
  memoryMb: 32,
};

/**
 * Executes user-supplied analyzer JavaScript in a V8 isolate with injected helpers.
 * Analyzer code must define `function analyze(input) { ... }` returning `{ label, details }`.
 */
export class SandboxedAnalyzerRunner {
  private readonly opts: SandboxedAnalyzerRunnerOptions;

  constructor(options: Partial<SandboxedAnalyzerRunnerOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  async runAnalyzerCode(code: string, inputSnapshot: SandboxAnalyzerInputSnapshot): Promise<SandboxRunResult> {
    const isolate = new ivm.Isolate({ memoryLimit: this.opts.memoryMb });
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set("global", jail.derefInto());

      const inputCopy = new ivm.ExternalCopy({
        candles: inputSnapshot.candles,
        referenceLevels: inputSnapshot.referenceLevels,
        params: inputSnapshot.params,
      });
      await jail.set("__INPUT", inputCopy.copyInto({ release: true }));

      await jail.set(
        "__getCandlePosition",
        new ivm.Callback((a: unknown, b: unknown) => getCandlePosition(a, b))
      );
      await jail.set(
        "__findFirstInteraction",
        new ivm.Callback((a: unknown, b: unknown) => findFirstInteraction(a, b))
      );
      await jail.set(
        "__getCandlesInWindow",
        new ivm.Callback((a: unknown, b: unknown, c: unknown) => getCandlesInWindow(a, b, c))
      );
      await jail.set(
        "__hasWickTouch",
        new ivm.Callback((a: unknown, b: unknown, c: unknown) => hasWickTouch(a, b, c))
      );

      const wrapper = `
        (function() {
          var input = __INPUT;
          input.helpers = {
            getCandlePosition: __getCandlePosition,
            findFirstInteraction: __findFirstInteraction,
            getCandlesInWindow: __getCandlesInWindow,
            hasWickTouch: __hasWickTouch
          };
          ${code}
          if (typeof analyze !== "function") {
            throw new Error("Analyzer must define function analyze(input)");
          }
          var out = analyze(input);
          return JSON.stringify(out);
        })()
      `;

      const script = await isolate.compileScript(wrapper);
      const result = await script.run(context, { timeout: this.opts.timeoutMs, release: true });

      if (typeof result !== "string") {
        return { label: "ERROR", details: { error: "invalid_output", rawType: typeof result } };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(result);
      } catch {
        return { label: "ERROR", details: { error: "invalid_json", raw: result } };
      }

      if (typeof parsed !== "object" || parsed === null) {
        return { label: "ERROR", details: { error: "invalid_output_shape" } };
      }
      const po = parsed as Record<string, unknown>;
      const label = po["label"];
      const details = po["details"];
      if (typeof label !== "string") {
        return { label: "ERROR", details: { error: "invalid_label" } };
      }
      if (typeof details === "object" && details !== null && !Array.isArray(details)) {
        return { label, details: details as Record<string, unknown> };
      }
      return { label, details: {} };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      const isTimeout = lower.includes("timeout");
      return {
        label: "ERROR",
        details: { error: isTimeout ? "timeout" : "exec_error", message: msg },
      };
    } finally {
      isolate.dispose();
    }
  }
}
