import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";

/** Shown only after the SERVER has marked the lecture complete. */
export function CompletionBanner({ next }: { next?: { href: string; title: string } | null }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-on-primary" aria-hidden>
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        </span>
        <div>
          <p className="font-medium text-ink">Lecture complete</p>
          <p className="text-sm text-success-strong">Nice work — this lecture is marked as watched.</p>
        </div>
      </div>
      {next && (
        <Link href={next.href} className={buttonClassName("primary", false, "md", "sm:shrink-0")}>
          Next: {next.title}
        </Link>
      )}
    </div>
  );
}
