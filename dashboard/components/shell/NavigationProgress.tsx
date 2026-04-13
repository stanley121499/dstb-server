"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Thin animated progress bar at the very top of the page.
 *
 * Flow:
 *  1. NavBar sets `navigationStart` via a custom DOM event when a link is clicked.
 *  2. This component starts the shimmer animation immediately.
 *  3. When `usePathname()` changes (navigation completed), we flash the bar to
 *     full width, then fade it out.
 */
export function NavigationProgress(): React.ReactElement {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    function onNavigationStart(): void {
      setFinishing(false);
      setActive(true);
    }
    window.addEventListener("navigationStart", onNavigationStart);
    return () => window.removeEventListener("navigationStart", onNavigationStart);
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    setFinishing(true);
    const t = setTimeout(() => {
      setActive(false);
      setFinishing(false);
    }, 400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!active && !finishing) {
    return <></>;
  }

  return (
    <div
      className={cn(
        "pointer-events-none fixed left-0 top-0 z-50 h-[3px] bg-primary transition-all duration-300",
        finishing ? "w-full opacity-0" : "w-3/4 opacity-100 animate-pulse"
      )}
      aria-hidden="true"
    />
  );
}
