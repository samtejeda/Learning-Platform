import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getOwnedMaterial } from "@/lib/data/course-materials";
import { updateMaterial } from "@/lib/course-materials/actions";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { CourseForm } from "@/components/course-form";

const paramsSchema = z.object({ materialId: z.uuid() });

export const metadata = { title: "Edit material" };

export default async function EditMaterialPage({
  params,
}: {
  params: Promise<{ materialId: string }>;
}) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const user = await requireRole("professor", "admin");
  // Ownership of the parent course is joined inside the query.
  const material = await getOwnedMaterial(parsed.data.materialId, user);
  if (!material) notFound();

  return (
    <div className="max-w-xl space-y-6 sm:space-y-8">
      <PageHeader
        back={<BackLink href={`/professor/courses/${material.courseId}`}>Back to course</BackLink>}
        title="Edit material"
        lead={
          material.kind === "file"
            ? "Title and description only. To replace the file, delete this material and add it again."
            : "Title and description only. To change the URL, delete this material and add it again."
        }
      />
      <Card>
        {/* Same field names as a course (title, description); the bound id is re-checked in the action. */}
        <CourseForm
          action={updateMaterial.bind(null, material.id)}
          initial={{ title: material.title, description: material.description }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </Card>
    </div>
  );
}
