import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Shared bodies for each route group's loading.tsx / error.tsx /
// not-found.tsx so the three states look identical across roles.

export function NotFoundState({ home, homeLabel }: { home: string; homeLabel: string }) {
  return (
    <div className="mx-auto max-w-md pt-6 text-center sm:pt-16">
      <p className="text-sm font-medium uppercase tracking-[1.5px] text-muted">404</p>
      <h1 className="mt-2 text-[2rem] sm:text-4xl">We couldn&apos;t find that</h1>
      <p className="mt-3 text-muted">
        The page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href={home} className={buttonClassName("secondary", false, "md", "mt-8")}>
        {homeLabel}
      </Link>
    </div>
  );
}

export function ErrorState({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-md pt-6 sm:pt-16">
      <Card variant="outlined">
        <h1 className="text-[1.75rem]">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          The error has been logged. Try again, and if it keeps happening let your professor or
          the administrator know.
        </p>
        <button
          type="button"
          onClick={reset}
          className={buttonClassName("primary", false, "md", "mt-6")}
        >
          Try again
        </button>
      </Card>
    </div>
  );
}

/** Generic page skeleton: header + two content blocks. */
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="space-y-3">
        <div className="h-9 w-2/3 max-w-xs rounded-md bg-surface-card" />
        <div className="h-4 w-1/2 max-w-sm rounded-md bg-surface-soft" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-28 rounded-lg bg-surface-card" />
        <div className="h-28 rounded-lg bg-surface-card" />
      </div>
    </div>
  );
}
