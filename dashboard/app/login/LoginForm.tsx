"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/**
 * Email/password sign-in form.
 */
export function LoginForm(): React.ReactElement {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr !== null) {
        setError(signErr.message);
        return;
      }
      router.refresh();
      router.push("/");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">DSTB Dashboard</h1>
        <p className="text-sm text-muted-foreground">Sign in with your Supabase account.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          required
        />
      </div>
      {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
