"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Top navigation and sign-out for authenticated routes.
 *
 * Tracks which nav link was clicked so we can show a pending indicator while
 * the server component for that route is loading. The indicator clears
 * automatically when the pathname changes (navigation completed).
 */
export function NavBar(): React.ReactElement {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Clear pending state when navigation completes.
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  function handleLinkClick(href: string): void {
    if (href === pathname) {
      return;
    }
    setPendingHref(href);
    window.dispatchEvent(new Event("navigationStart"));
  }

  async function signOut(): Promise<void> {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function linkCls(href: string): string {
    const isActive = pathname === href || pathname.startsWith(`${href}/`);
    const isPending = pendingHref === href;
    return cn(
      "relative text-sm transition-colors",
      isActive || isPending
        ? "text-foreground font-medium"
        : "text-muted-foreground hover:text-foreground",
      isPending && "opacity-70"
    );
  }

  const navLinks: Array<{ href: string; label: string }> = [
    { href: "/", label: "Bots" },
    { href: "/trades", label: "Trades" },
    { href: "/analytics", label: "Analytics" },
    { href: "/behavior", label: "Behavior" },
    { href: "/behavior/analyzers", label: "B. Analyzers" },
    { href: "/behavior/rulesets", label: "B. Rulesets" },
    { href: "/behavior/environments", label: "B. Environments" },
    { href: "/logs", label: "Logs" },
    { href: "/config/new", label: "New config" },
  ];

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-14 items-center justify-between gap-4 px-4">
        <nav className="flex items-center gap-6 overflow-x-auto text-sm">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={linkCls(href)}
              onClick={() => handleLinkClick(href)}
            >
              {label}
              {pendingHref === href ? (
                <span className="absolute -right-3 -top-1 flex h-2 w-2 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
