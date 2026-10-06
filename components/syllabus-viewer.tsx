"use client";

import { DocumentIcon, OpenFileRow } from "@/components/course-files/file-row";

/**
 * Tap-to-open syllabus: a single row that fetches the signed PDF URL on tap
 * and opens it in a new tab (the browser's or phone's own PDF viewer) — the
 * same pattern as a file course material, via components/course-files. No
 * inline embed and nothing is fetched on page load. Used by the student
 * page and the professor's own preview.
 */
export function SyllabusViewer({ courseId }: { courseId: string }) {
  return (
    <OpenFileRow
      endpoint={`/api/courses/${courseId}/syllabus`}
      title="View syllabus (PDF)"
      description="Opens in a new tab"
      leading={
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-canvas text-primary-active">
          <DocumentIcon />
        </span>
      }
    />
  );
}
