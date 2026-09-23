"use client";

import { useSignedFileUrl } from "@/components/course-files/use-signed-file-url";
import { Alert } from "@/components/ui/alert";

/**
 * Renders a course's syllabus PDF inline via <iframe>, plus an "Open in new
 * tab" link as a fallback for browsers/contexts that don't render PDFs
 * inline (e.g. some mobile in-app browsers). Used by both the student page
 * and the professor's own preview.
 */
export function SyllabusViewer({ courseId }: { courseId: string }) {
  const syllabus = useSignedFileUrl(`/api/courses/${courseId}/syllabus`);

  if (syllabus.status === "loading") {
    return <p className="text-sm text-muted">Loading syllabus…</p>;
  }

  if (syllabus.status === "error") {
    return (
      <Alert tone="error">
        {syllabus.message}{" "}
        <button type="button" onClick={syllabus.refresh} className="font-medium underline underline-offset-2">
          Try again
        </button>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <iframe
        src={syllabus.url}
        title="Syllabus"
        className="h-[70vh] w-full rounded-md border border-hairline bg-canvas"
      />
      <a
        href={syllabus.url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-primary hover:underline"
      >
        Open in new tab
      </a>
    </div>
  );
}
