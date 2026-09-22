"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/validation/form";
import type { ProfessorLecture } from "@/lib/data/lectures";
import { deleteLecture, publishLecture, reorderLectures, unpublishLecture } from "@/lib/lectures/actions";
import { formatTime } from "@/lib/video/format-time";
import { Button, buttonClassName } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { DataList, DataRowIndex } from "@/components/ui/data-list";
import { LectureUploadForm } from "./lecture-upload-form";

const STATUS: Record<
  ProfessorLecture["status"],
  { label: string; tone: "warning" | "outline" | "success" }
> = {
  pending_upload: { label: "Upload pending", tone: "warning" },
  draft: { label: "Draft", tone: "outline" },
  published: { label: "Published", tone: "success" },
};

/**
 * Professor's lecture list: status, move up/down, edit, publish/unpublish,
 * retry a pending upload, delete. Row actions are individual forms bound to
 * the lecture id, so they work without client JS; reordering needs JS.
 * On phones the action row wraps under the title.
 */
export function LectureListManager({ courseId, lectures }: { courseId: string; lectures: ProfessorLecture[] }) {
  const router = useRouter();
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [retrying, setRetrying] = useState<string | null>(null);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= lectures.length) return;
    const ids = lectures.map((l) => l.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    startTransition(async () => {
      const result = await reorderLectures(courseId, { orderedIds: ids });
      setReorderError(result?.error ?? null);
      router.refresh();
    });
  }

  if (lectures.length === 0) {
    return <p className="text-sm text-muted">No lectures yet. Add the first one below.</p>;
  }

  const iconBtn =
    "inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-cream-strong hover:text-ink focus-visible:focus-ring disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="space-y-3">
      {reorderError && <Alert tone="error">{reorderError}</Alert>}
      <DataList>
        {lectures.map((lecture, i) => {
          const status = STATUS[lecture.status];
          return (
            <li key={lecture.id} className="py-3">
              <div className="flex items-start gap-2">
                <DataRowIndex>{i + 1}</DataRowIndex>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium text-ink">{lecture.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {lecture.durationSeconds ? <span>{formatTime(lecture.durationSeconds)}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center" role="group" aria-label={`Reorder ${lecture.title}`}>
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={isPending || i === 0}
                    onClick={() => move(i, -1)}
                    aria-label="Move up"
                  >
                    <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={iconBtn}
                    disabled={isPending || i === lectures.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Move down"
                  >
                    <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M8 3v10m4.5-4.5L8 13 3.5 8.5" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1 pl-8">
                <Link href={`/professor/lectures/${lecture.id}/edit`} className={buttonClassName("ghost", false, "sm")}>
                  Edit
                </Link>
                {lecture.status !== "pending_upload" && (
                  <Link
                    href={`/courses/${courseId}/lectures/${lecture.id}`}
                    className={buttonClassName("ghost", false, "sm")}
                  >
                    Preview
                  </Link>
                )}
                {lecture.status === "pending_upload" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setRetrying(retrying === lecture.id ? null : lecture.id)}
                    aria-expanded={retrying === lecture.id}
                  >
                    {retrying === lecture.id ? "Cancel upload" : "Upload video"}
                  </Button>
                )}
                {lecture.status === "draft" && (
                  <RowAction label="Publish" variant="secondary" action={publishLecture.bind(null, lecture.id)} />
                )}
                {lecture.status === "published" && (
                  <RowAction label="Unpublish" variant="ghost" action={unpublishLecture.bind(null, lecture.id)} />
                )}
                <span className="flex-1" />
                <RowAction
                  label="Delete"
                  variant="ghost"
                  danger
                  action={deleteLecture.bind(null, lecture.id)}
                  confirm={`Delete "${lecture.title}" and its video? Students' progress on it is removed too.`}
                />
              </div>

              {retrying === lecture.id && (
                <div className="mt-3 rounded-md border border-hairline bg-canvas p-4 sm:ml-8">
                  <LectureUploadForm courseId={courseId} retryLectureId={lecture.id} />
                </div>
              )}
            </li>
          );
        })}
      </DataList>
    </div>
  );
}

function RowAction({
  label,
  action,
  variant,
  danger,
  confirm: confirmText,
}: {
  label: string;
  action: (prev: ActionState) => Promise<ActionState>;
  variant: "secondary" | "ghost";
  danger?: boolean;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState>(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className="contents"
    >
      <Button
        type="submit"
        variant={variant}
        size="sm"
        disabled={pending}
        aria-busy={pending}
        className={danger ? "text-error hover:text-error" : undefined}
      >
        {pending ? "…" : label}
      </Button>
      {state?.error && (
        <span role="alert" className="basis-full pt-1 text-xs text-error">
          {state.error}
        </span>
      )}
    </form>
  );
}
