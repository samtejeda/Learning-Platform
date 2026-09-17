import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireRole("admin");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
      <Card>
        <p className="text-slate-700 font-medium">Admin tools are not built yet.</p>
        <p className="text-sm text-slate-500 mt-1">
          The admin role&apos;s scope is still to be defined (see CLAUDE.md). For now, roles are
          changed directly in the database.
        </p>
      </Card>
    </div>
  );
}
