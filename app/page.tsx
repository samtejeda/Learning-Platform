import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/** "/" is just a router: signed-out → login, signed-in → role home. */
export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? homeForRole(user.role) : "/login");
}
