import Link from "next/link";

import { BehaviorAnalyzerNewClient } from "@/components/behavior-analyzer-new-client";
import { buttonVariants } from "@/components/ui/button";

/**
 * Phase 5 — create analyzer (LLM-generated JS or native_s2).
 */
export default function NewAnalyzerPage(): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">New analyzer</h1>
        <Link href="/behavior/analyzers" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back
        </Link>
      </div>
      <BehaviorAnalyzerNewClient />
    </div>
  );
}
