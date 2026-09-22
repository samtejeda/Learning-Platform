import Link from "next/link";
import type { ReactNode } from "react";

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-sm font-medium text-muted hover:text-ink focus-visible:focus-ring"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M10 3 5 8l5 5" />
      </svg>
      {children}
    </Link>
  );
}
