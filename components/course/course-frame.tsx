import type { ReactNode } from "react";
import { CourseChips, CourseSidebar } from "./course-nav";
import type { CourseSection } from "./sections";

/**
 * The course page body: sidebar on wide screens, sticky chip row on phones,
 * the sections in between. One breakpoint (`lg`, 1024px) switches them, so
 * the chips and the sidebar can never both show.
 */
export function CourseFrame({ sections, children }: { sections: CourseSection[]; children: ReactNode }) {
  if (sections.length === 0) return <>{children}</>;
  return (
    <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <CourseSidebar sections={sections} />
      <div className="min-w-0 space-y-6 sm:space-y-8">
        <CourseChips sections={sections} />
        {children}
      </div>
    </div>
  );
}
