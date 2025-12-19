import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config for `apps/web`.
 *
 * Notes:
 * - Keep config minimal and platform-agnostic (Windows-friendly).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
});
