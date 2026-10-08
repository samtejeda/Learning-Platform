"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SectionIcon } from "./section-icon";
import { collapsedStorageKey, parseCollapsed, sectionById, type CourseView, type SectionId } from "./sections";

/**
 * One collapsible section of a course page. The header is a real button
 * (aria-expanded + aria-controls) and stays visible when collapsed, with a
 * one-line status. Collapsing only hides the body (the `hidden` attribute);
 * it never unmounts it, so a professor's half-filled form survives.
 *
 * Remembered state is a per-viewer convenience: every storage call is in a
 * try/catch, the first render is always "open" (identical to the server's, so
 * no hydration mismatch) and the saved state is applied after mount.
 */
export function CourseSection({
  id,
  courseId,
  view,
  status,
  children,
}: {
  id: SectionId;
  courseId: string;
  view: CourseView;
  /** One line, from data the page already loaded. */
  status: string;
  children: ReactNode;
}) {
  const section = sectionById(id);
  const [collapsed, setCollapsed] = useState(false);
  const key = collapsedStorageKey(view, courseId);

  useEffect(() => {
    try {
      setCollapsed(parseCollapsed(window.localStorage.getItem(key)).includes(id));
    } catch {
      /* storage blocked: stay open */
    }
  }, [key, id]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      const set = new Set(parseCollapsed(window.localStorage.getItem(key)));
      if (next) set.add(id);
      else set.delete(id);
      window.localStorage.setItem(key, JSON.stringify([...set]));
    } catch {
      /* storage blocked: the toggle still works for this visit */
    }
  }

  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-[7.5rem] rounded-lg bg-surface-card text-body lg:scroll-mt-24">
      <h2 id={`${id}-heading`} className="font-sans text-lg font-medium tracking-normal text-ink">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={`${id}-content`}
          onClick={toggle}
          className="flex min-h-16 w-full items-center gap-3 rounded-lg p-4 text-left focus-visible:focus-ring sm:px-6"
        >
          <SectionIcon id={id} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{section.title}</span>
            <span className="block truncate text-sm font-normal text-muted">{status}</span>
          </span>
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className={`size-5 shrink-0 text-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </h2>
      <div id={`${id}-content`} hidden={collapsed} className="px-4 pb-5 sm:px-6 sm:pb-6">
        {children}
      </div>
    </section>
  );
}
