import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  homeForRole,
  isApiPath,
  isAuthEntryPath,
  isPublicPath,
  roleFromClaims,
} from "@/lib/auth/roles";

// Next.js 16 renamed middleware.ts → proxy.ts and requires the exported
// function to be named `proxy` (or a default export). Route segment config
// such as `runtime` is not allowed here; proxy always runs on Node.js.
//
// This is the FIRST of three gates and the only one that runs on every
// request. It answers two cheap questions from the verified JWT:
//   1. is there a session at all?  (else → /login?next=…)
//   2. does the role in the token allow this path prefix?  (else → role home)
// It is a convenience redirect, not the authorization boundary. Layouts,
// pages, actions, and route handlers re-check identity and role against the
// database via lib/auth/session.ts, and data functions enforce ownership.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() verifies the JWT signature (against the project's JWKS, or
  // via the auth server for legacy HS256 projects) and refreshes the session
  // when needed, which is what keeps Server Components' cookies fresh.
  const { data } = await supabase.auth.getClaims();
  const claims: unknown = data?.claims ?? null;
  const { pathname } = request.nextUrl;

  if (!claims) {
    if (isPublicPath(pathname)) return supabaseResponse;
    // API callers get a machine-readable 401, not an HTML login redirect.
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: { code: "unauthenticated", message: "Please sign in." } },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    // Remember where the user was headed so login can return them there.
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Sessions issued before the role claim existed have no role in the token;
  // treat them as the least-privileged role here. The DB-backed gate decides.
  const role = roleFromClaims(claims) ?? "student";

  if (isAuthEntryPath(pathname) || !canAccessPath(pathname, role)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = homeForRole(role);
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
