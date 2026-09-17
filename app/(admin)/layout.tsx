import { requireRole } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";

// Second gate after the proxy: /admin/* is admin-only.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("admin");
  return <AppShell user={user}>{children}</AppShell>;
}
