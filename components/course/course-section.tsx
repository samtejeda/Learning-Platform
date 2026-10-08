"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { SectionIcon } from "./section-icon";
import { collapsedStorageKey, parseCollapsed, sectionById, type CourseView, type SectionId } from "./sections";

// Collapsed state lives in localStorage as a per-viewer convenience. It is read
// through useSyncExternalStore with a server snapshot of "nothing stored", so
// the server render and the hydration render are identical (all open) and the
// saved state is applied right after. Every storage call is in a try/catch; if
// storage is blocked the toggle still works for this visit via `memory`.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeStored(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* blocked: memory keeps it for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * One collapsible section of a course page. The header is a real button
 * (aria-expanded + aria-controls) and stays visible when collapsed, with a
 * one-line status. Collapsing only hides the body (the `hidden` attribute);
 * it never unmounts it, so a professor's half-filled form survives.
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
  const key = collapsedStorageKey(view, courseId);
  const raw = useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
  const collapsed = parseCollapsed(raw).includes(id);

  function toggle() {
    const set = new Set(parseCollapsed(readStored(key)));
    if (collapsed) set.delete(id);
    else set.add(id);
    writeStored(key, JSON.stringify([...set]));
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
