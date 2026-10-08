"use client";

import { SectionIcon } from "./section-icon";
import type { CourseSection } from "./sections";
import { useActiveSection } from "./use-active-section";

// In-page links (#lectures …): they work without JS. The current section is
// marked with aria-current AND a filled background, bold text and a bar, so
// colour is never the only signal.

/** Phones and tablets: a sticky row of chips under the header. Hidden from `lg` up. */
export function CourseChips({ sections }: { sections: CourseSection[] }) {
  const [active, setActive] = useActiveSection(
    sections.map((s) => s.id),
    140,
  );
  return (
    <nav
      aria-label="Course sections"
      className="sticky top-14 z-10 -mx-4 border-b border-hairline bg-canvas/95 px-4 backdrop-blur sm:top-14 lg:hidden"
    >
      <ul role="list" className="flex gap-1 py-1">
        {sections.map((s) => {
          const current = active === s.id;
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <a
                href={`#${s.id}`}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(s.id)}
                className={`flex min-h-11 items-center justify-center truncate rounded-md px-1 text-[13px] transition-colors focus-visible:focus-ring ${
                  current
                    ? "bg-surface-card font-semibold text-ink shadow-[inset_0_-2px_0_0_var(--color-primary)]"
                    : "font-medium text-muted hover:bg-surface-soft hover:text-ink"
                }`}
              >
                {s.chip}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Wide screens: a left sidebar, the same sections in the same order. Hidden below `lg`. */
export function CourseSidebar({ sections }: { sections: CourseSection[] }) {
  const [active, setActive] = useActiveSection(
    sections.map((s) => s.id),
    100,
  );
  return (
    <aside className="hidden lg:block">
      <nav aria-label="Course sections" className="sticky top-24">
        <ul role="list" className="space-y-1">
          {sections.map((s) => {
            const current = active === s.id;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={current ? "location" : undefined}
                  onClick={() => setActive(s.id)}
                  className={`flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 text-sm transition-colors focus-visible:focus-ring ${
                    current
                      ? "border-primary bg-surface-card font-semibold text-ink"
                      : "border-transparent font-medium text-muted hover:bg-surface-soft hover:text-ink"
                  }`}
                >
                  <SectionIcon id={s.id} size="sm" />
                  <span className="truncate">{s.title}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
