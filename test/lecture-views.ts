import type { LectureView, OpenLectureView } from "@/lib/data/progress";

/** Test helper: assert a viewer's lecture is open (not null, not locked) and narrow the type. */
export function openView(view: LectureView | null): OpenLectureView {
  if (!view) throw new Error("expected a lecture view, got null");
  if (view.locked) throw new Error(`expected an open lecture, got a locked one (${view.lock.reason})`);
  return view;
}
