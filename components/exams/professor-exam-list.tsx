import Link from "next/link";
import type { listExamsForProfessor } from "@/lib/data/exams";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { DataList, DataRowIndex } from "@/components/ui/data-list";
import { RowChevron } from "@/components/ui/row-chevron";

type Exams = Awaited<ReturnType<typeof listExamsForProfessor>>;

/** The professor's Exams card on the course page: status badge + counts per row. */
export function ProfessorExamList({ exams }: { exams: Exams }) {
  const published = exams.filter((e) => e.status === "published").length;
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-3">
        <CardTitle>Exams</CardTitle>
        <span className="text-sm tabular-nums text-muted">
          {exams.length === 0 ? "None yet" : `${published} of ${exams.length} published`}
        </span>
      </div>
      {exams.length === 0 ? (
        <p className="text-sm text-muted">No exams yet. Add one below.</p>
      ) : (
        <DataList>
          {exams.map((e, i) => (
            <li key={e.id}>
              <Link
                href={`/professor/exams/${e.id}`}
                className="-mx-2 flex min-h-14 items-center gap-3 rounded-md px-2 py-3 hover:bg-surface-cream-strong/60 focus-visible:focus-ring"
              >
                <DataRowIndex>{i + 1}</DataRowIndex>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium text-ink">
                    {e.titleEn || e.titleEs || "Untitled exam"}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>
                      {e.questionCount} {e.questionCount === 1 ? "question" : "questions"}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{e.durationMinutes} min</span>
                    <span aria-hidden>·</span>
                    <span>
                      {e.maxAttempts} {e.maxAttempts === 1 ? "attempt" : "attempts"}
                    </span>
                  </div>
                </div>
                <Badge tone={e.status === "published" ? "success" : "outline"}>
                  {e.status === "published" ? "Published" : "Draft"}
                </Badge>
                <RowChevron />
              </Link>
            </li>
          ))}
        </DataList>
      )}
    </Card>
  );
}
