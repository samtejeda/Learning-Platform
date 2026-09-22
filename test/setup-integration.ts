import { vi } from "vitest";

if (process.env.INTEGRATION_TESTS !== "1") {
  throw new Error(
    "Integration tests touch the database in .env.local. Run `pnpm test:integration` (sets INTEGRATION_TESTS=1).",
  );
}

// ─── Acting user ──────────────────────────────────────────────────────────────
// lib/auth/session.getCurrentUser verifies the session with Supabase Auth
// (`getUser`) and then reads the role from public.users. We stub only the
// Supabase call, so the DB-backed role check and everything after it are
// the real code paths.

let actingUserId: string | null = null;

/** Make subsequent actions/data calls run as this auth user id (or signed out). */
export function actAs(userId: string | null) {
  actingUserId = userId;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: actingUserId ? { id: actingUserId } : null } }),
    },
  }),
}));

// React `cache` memoises getCurrentUser per request; outside a request it
// would memoise forever, so make it a plain passthrough here.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

// ─── Next.js request plumbing ─────────────────────────────────────────────────

export const redirects: string[] = [];
export const revalidated: string[] = [];

export class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.push(to);
    throw new RedirectSignal(to);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    revalidated.push(p);
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
