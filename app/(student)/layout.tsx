import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";

// Second gate after the proxy. Any signed-in role may use the student
// surface (a professor previewing as a student is fine); data functions
// still require enrollment. Pages re-check via requireUser() themselves.
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
