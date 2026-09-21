import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { homeForRole, type Role } from "./roles";

export type CurrentUser = {
  id: string;
  role: Role;
  fullName: string | null;
  email: string | null;
};

export class AuthError extends Error {
  constructor(public readonly kind: "unauthenticated" | "forbidden") {
    super(kind === "unauthenticated" ? "Not signed in" : "Not allowed");
    this.name = "AuthError";
  }
}

/**
 * The authoritative identity check. Verifies the session with the Supabase
 * Auth server (`getUser()`, not the cookie-only `getSession()`), then reads
 * the role from our `users` table, not from the JWT. Memoised per request via
 * React `cache` so layouts, pages, and actions can all call it for free.
 *
 * Returns null when there is no session OR when the auth user has no profile
 * row (that row is created by a DB trigger; if it's missing something is
 * wrong and we deny rather than auto-create).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const row = await db.query.users.findFirst({
    where: eq(users.id, user.id),
    columns: { id: true, role: true, fullName: true, email: true },
  });
  if (!row) {
    logger.error("auth.profile_row_missing", { userId: user.id });
    return null;
  }
  return row;
});

// ─── For pages and layouts (redirect on failure) ─────────────────────────────

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homeForRole(user.role));
  return user;
}

// ─── For server actions and route handlers (throw on failure) ────────────────
// Actions return `{ error }` to the form and must not redirect() on failure;
// route handlers map AuthError to 401/403 via lib/api/respond.ts.

export async function assertUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("unauthenticated");
  return user;
}

export async function assertRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await assertUser();
  if (!roles.includes(user.role)) throw new AuthError("forbidden");
  return user;
}
