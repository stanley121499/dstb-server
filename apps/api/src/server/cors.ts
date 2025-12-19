/**
 * Determines whether a given Origin should be allowed for CORS.
 *
 * Rules (from docs):
 * - Allow local dev: http://localhost:5173
 * - Allow Vercel domains: *.vercel.app
 * - Allow additional explicit origins via env (comma-separated)
 */
export function isAllowedCorsOrigin(args: {
  origin: string | undefined;
  extraAllowedOriginsCsv: string;
}): boolean {
  const origin = args.origin;
  if (origin === undefined) {
    // Non-browser clients (curl/postman/server-to-server) may omit Origin.
    return true;
  }

  if (origin === "http://localhost:5173") {
    return true;
  }

  // Vercel previews / prod end in ".vercel.app"
  if (origin.endsWith(".vercel.app")) {
    return true;
  }

  const extras = args.extraAllowedOriginsCsv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return extras.includes(origin);
}

