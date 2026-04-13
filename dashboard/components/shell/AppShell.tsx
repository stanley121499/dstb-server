"use client";

import { usePathname } from "next/navigation";

import { NavBar } from "@/components/shell/NavBar";

/**
 * Wraps the app with navigation except on `/login`.
 */
export function AppShell({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  const pathname = usePathname();
  if (pathname === "/login") {
    return <>{children}</>;
  }
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1 container mx-auto p-4 md:p-6">{children}</main>
    </div>
  );
}
