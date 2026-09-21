import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// HTTP-level tests: drive a RUNNING server (default http://localhost:3111,
// override with E2E_BASE_URL) with real Supabase sessions, the real proxy,
// and the real Storage bucket. No Next.js stubs. Seeds the same dev-only
// @example.test accounts as the integration tests. Run:
//   pnpm build && pnpm start -p 3111    # in one terminal
//   pnpm test:http                      # in another
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/http/**/*.http.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup-http.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
