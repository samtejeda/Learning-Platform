// The ONE list of course sections. The page order, the phone chips and the
// desktop sidebar all read from it, so they cannot drift. Order is fixed by
// Sam (2026-10-07): Syllabus, Lectures, Course materials, Exams. Students is
// a professor-only extra, last.
//
// A section's icon and colour treatment are keyed by `id` in section-icon.tsx.

export type SectionId = "syllabus" | "lectures" | "materials" | "exams" | "students";
export type CourseView = "student" | "professor";

export type CourseSection = {
  id: SectionId;
  /** Heading on the page and label in the sidebar. */
  title: string;
  /** Short label for the phone chips. */
  chip: string;
  /** Which course pages show it. */
  views: readonly CourseView[];
};

export const COURSE_SECTIONS: readonly CourseSection[] = [
  { id: "syllabus", title: "Syllabus", chip: "Syllabus", views: ["student", "professor"] },
  { id: "lectures", title: "Lectures", chip: "Lectures", views: ["student", "professor"] },
  { id: "materials", title: "Course materials", chip: "Materials", views: ["student", "professor"] },
  { id: "exams", title: "Exams", chip: "Exams", views: ["student", "professor"] },
  { id: "students", title: "Students", chip: "Students", views: ["professor"] },
];

/**
 * The sections a page shows, in the fixed order. `present` lets the student
 * page drop sections that have no content (a section appears only when it
 * has something); a missing key means "show it", so professors, who always
 * see their add-content sections, pass nothing.
 */
export function sectionsFor(view: CourseView, present: Partial<Record<SectionId, boolean>> = {}): CourseSection[] {
  return COURSE_SECTIONS.filter((s) => s.views.includes(view) && present[s.id] !== false);
}

export const sectionById = (id: SectionId): CourseSection => COURSE_SECTIONS.find((s) => s.id === id)!;

// ── Remembered collapsed state (per course, per viewer, in the browser) ──────

export const collapsedStorageKey = (view: CourseView, courseId: string) => `course-sections:${view}:${courseId}`;

/** Parse what was stored; anything unexpected means "nothing collapsed". */
export function parseCollapsed(raw: string | null): SectionId[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((x): x is SectionId => COURSE_SECTIONS.some((s) => s.id === x));
  } catch {
    return [];
  }
}
