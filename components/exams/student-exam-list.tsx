import Link from "next/link";
import type { listExamsForStudent } from "@/lib/data/exam-attempts";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { DataList, DataRowIndex } from "@/components/ui/data-list";
import { RowChevron } from "@/components/ui/row-chevron";

type Exams = Awaited<ReturnType<typeof listExamsForStudent>>;

/** The student's Exams card on the course page: same row language as the lectures. */
export function StudentExamList({ courseId, exams }: { courseId: string; exams: Exams }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-3">
        <CardTitle>Exams</CardTitle>
        <span className="text-sm tabular-nums text-muted">
          {exams.length} {exams.length === 1 ? "exam" : "exams"}
        </span>
      </div>
      <DataList>
        {exams.map((e, i) => (
          <li key={e.id}>
            <Link
              href={`/courses/${courseId}/exams/${e.id}`}
              className="-mx-2 flex min-h-14 items-center gap-3 rounded-md px-2 py-3 hover:bg-surface-cream-strong/60 focus-visible:focus-ring"
            >
              <DataRowIndex>{i + 1}</DataRowIndex>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-ink">{e.title ?? "Exam"}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span>{e.durationMinutes} min</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">
                    {e.attemptsUsed} of {e.maxAttempts} attempts used
                  </span>
                </div>
              </div>
              {e.gradeOfRecord !== null ? (
                <Badge tone="success">Grade: {e.gradeOfRecord}%</Badge>
              ) : e.openAttemptId ? (
                <Badge tone="neutral">In progress</Badge>
              ) : (
                <RowChevron />
              )}
            </Link>
          </li>
        ))}
      </DataList>
    </Card>
  );
}
