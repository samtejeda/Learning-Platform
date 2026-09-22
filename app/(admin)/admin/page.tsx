import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireRole("admin");
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader title="Admin" lead="Platform-level management." />
      <EmptyState
        title="Admin tools are not built yet."
        description="The admin role's scope is still to be defined. For now, roles are changed directly in the database."
      />
    </div>
  );
}
