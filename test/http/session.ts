import { createServerClient } from "@supabase/ssr";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3111";

/**
 * Sign in with email + password against the real Supabase Auth server and
 * return the Cookie header a browser would send afterwards. Uses the same
 * @supabase/ssr cookie encoding as the app, so the proxy and
 * getCurrentUser() see a genuine session.
 */
export async function signIn(email: string, password = "integration-test-password"): Promise<string> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
      },
    },
  );
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export type Http = {
  get: (path: string, init?: RequestInit) => Promise<Response>;
  post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
};

/** A tiny client bound to one session cookie (or none). Never follows redirects. */
export function client(cookie?: string): Http {
  const base: RequestInit = { redirect: "manual", headers: cookie ? { cookie } : {} };
  return {
    get: (path, init) =>
      fetch(`${BASE_URL}${path}`, { ...base, ...init, headers: { ...(base.headers as object), ...(init?.headers as object) } }),
    post: (path, body, headers = {}) =>
      fetch(`${BASE_URL}${path}`, {
        ...base,
        method: "POST",
        headers: {
          ...(base.headers as object),
          "content-type": "application/json",
          origin: BASE_URL,
          ...headers,
        },
        body: JSON.stringify(body),
      }),
  };
}
