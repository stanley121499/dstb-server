import path from "path";
import type { NextConfig } from "next";

/**
 * Monorepo: `next` is hoisted to the repo root `node_modules`, so Turbopack root must include that tree.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "..")
  }
};

export default nextConfig;
