import { requireRole } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";

// Second gate after the proxy: /professor/* is for professors and admins.
// Pages re-check via requireRole() themselves (layouts don't re-run on
// sibling navigation), and data functions enforce course ownership.
export default async function ProfessorLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("professor", "admin");
  return <AppShell user={user}>{children}</AppShell>;
}
