"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/validation/form";
import type { ProfessorLecture } from "@/lib/data/lectures";
import { deleteLecture, publishLecture, reorderLectures, unpublishLecture } from "@/lib/lectures/actions";
import { Button } from "@/components/ui/button";
import { LectureUploadForm } from "./lecture-upload-form";

const STATUS_LABEL = {
  pending_upload: "Upload pending",
  draft: "Draft",
  published: "Published",
} as const;

/**
 * Professor's lecture list: status, publish/unpublish, delete, move
 * up/down, retry a pending upload, edit link. Plain by design.
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

  if (lectures.length === 0) return <p className="text-sm text-slate-500">No lectures yet.</p>;

  return (
    <div className="space-y-3">
      {reorderError && <p className="text-xs text-red-600">{reorderError}</p>}
      <ol className="divide-y divide-slate-100">
        {lectures.map((lecture, i) => (
          <li key={lecture.id} className="py-2.5 text-sm">
            <div className="flex gap-2 items-center">
              <span className="text-slate-400 w-6 shrink-0 tabular-nums">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <div className="text-slate-700 truncate">{lecture.title}</div>
                <div className="text-xs text-slate-500">
                  {STATUS_LABEL[lecture.status]}
                  {lecture.durationSeconds ? ` · ${formatDuration(lecture.durationSeconds)}` : ""}
                </div>
              </div>
              <div className="flex gap-1 items-center">
                <Button variant="ghost" className="px-2 py-1 text-xs" disabled={isPending || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  ↑
                </Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" disabled={isPending || i === lectures.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  ↓
                </Button>
                <Link href={`/professor/lectures/${lecture.id}/edit`} className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900">
                  Edit
                </Link>
                {lecture.status === "pending_upload" && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setRetrying(retrying === lecture.id ? null : lecture.id)}>
                    {retrying === lecture.id ? "Cancel" : "Upload"}
                  </Button>
                )}
                {lecture.status === "draft" && <RowAction label="Publish" action={publishLecture.bind(null, lecture.id)} />}
                {lecture.status === "published" && <RowAction label="Unpublish" action={unpublishLecture.bind(null, lecture.id)} />}
                <RowAction label="Delete" action={deleteLecture.bind(null, lecture.id)} confirm="Delete this lecture and its video?" />
              </div>
            </div>
            {retrying === lecture.id && (
              <div className="mt-3 ml-8">
                <LectureUploadForm courseId={courseId} retryLectureId={lecture.id} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RowAction({
  label,
  action,
  confirm: confirmText,
}: {
  label: string;
  action: (prev: ActionState) => Promise<ActionState>;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState>(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <Button type="submit" variant="ghost" disabled={pending} className="px-2 py-1 text-xs" title={state?.error ?? undefined}>
        {pending ? "…" : label}
      </Button>
      {state?.error && <span className="sr-only">{state.error}</span>}
    </form>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
