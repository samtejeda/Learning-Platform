import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Integration tests run the real data layer and server actions against the
// database in .env.local (the dev Supabase project), with only the Next.js
// request plumbing (cookies/headers/cache/redirect) stubbed. Run with:
//   pnpm test:integration
// They seed a few dev-only accounts (see test/seed.ts) and refuse to run
// unless INTEGRATION_TESTS=1 so they can never touch a real database by
// accident.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.integration.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup-integration.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
