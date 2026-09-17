import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/roles";

/**
 * GET /api/auth/callback?code=…&next=/path
 *
 * Landing point for Supabase email links (sign-up confirmation, password
 * reset). Exchanges the one-time PKCE code for a session cookie, then sends
 * the user on to `next` (sanitised; same-origin paths only). Any failure
 * goes back to /login with a generic flag; the code itself is never echoed.
 *
 * Public (proxy.ts allows /api/auth/*). No user input reaches the DB.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth] code exchange failed:", error.code ?? error.status);
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
