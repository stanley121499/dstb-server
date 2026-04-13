"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/**
 * Top navigation and sign-out for authenticated routes.
 */
export function NavBar(): React.ReactElement {
  const pathname = usePathname();

  async function signOut(): Promise<void> {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const linkCls = (href: string) =>
    pathname === href ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground";

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-14 items-center justify-between gap-4 px-4">
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className={linkCls("/")}>
            Bots
          </Link>
          <Link href="/trades" className={linkCls("/trades")}>
            Trades
          </Link>
          <Link href="/analytics" className={linkCls("/analytics")}>
            Analytics
          </Link>
          <Link href="/behavior" className={linkCls("/behavior")}>
            Behavior
          </Link>
          <Link href="/behavior/analyzers" className={linkCls("/behavior/analyzers")}>
            B. Analyzers
          </Link>
          <Link href="/behavior/rulesets" className={linkCls("/behavior/rulesets")}>
            B. Rulesets
          </Link>
          <Link href="/behavior/environments" className={linkCls("/behavior/environments")}>
            B. Environments
          </Link>
          <Link href="/logs" className={linkCls("/logs")}>
            Logs
          </Link>
          <Link href="/config/new" className={linkCls("/config/new")}>
            New config
          </Link>
        </nav>
        <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
