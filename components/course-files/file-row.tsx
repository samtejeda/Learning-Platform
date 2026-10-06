"use client";

import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { useOpenSignedFile } from "./use-open-signed-file";

// A whole-row tap target (>= 56px, same as the student lecture rows) that
// opens a file or link in a new tab. Shared by the syllabus and the course
// materials list so both look and behave identically.

export const fileRowClassName =
  "-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-surface-cream-strong/60 focus-visible:focus-ring disabled:cursor-wait disabled:opacity-60";

export function ExternalIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" />
    </svg>
  );
}

export function DocumentIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 2.5h6.5L15 6v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1ZM11 2.5V6h4M7 10h6M7 13h6" />
    </svg>
  );
}

/** Row content: leading slot, title + optional description, optional trailing badge. */
export function FileRowContent({
  leading,
  title,
  description,
  badge,
}: {
  leading?: ReactNode;
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      {badge}
      <ExternalIcon />
    </>
  );
}

/** Button row: fetches the signed URL for `endpoint` on tap and opens it in a new tab. */
export function OpenFileRow({
  endpoint,
  title,
  description,
  leading,
  badge,
}: {
  endpoint: string;
  title: string;
  description?: ReactNode;
  leading?: ReactNode;
  badge?: ReactNode;
}) {
  const { state, error, open } = useOpenSignedFile(endpoint);
  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={state === "loading"}
        aria-busy={state === "loading"}
        className={fileRowClassName}
      >
        <FileRowContent
          leading={leading}
          title={title}
          description={state === "loading" ? "Opening…" : description}
          badge={badge}
        />
      </button>
      {state === "error" && error && (
        <div className="mt-2">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
    </div>
  );
}
