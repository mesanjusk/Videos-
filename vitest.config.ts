import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit/integration tests for the framework-free engines under `src/core/` and the pure helpers in
 * `src/modules/`. Deliberately excludes anything that needs a live MongoDB, Redis, Chromium or a
 * provider API key — those are covered by the scripted checks in docs/DEPLOYMENT.md instead, so
 * `npm test` stays runnable with no infrastructure at all.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
