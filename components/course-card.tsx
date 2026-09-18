import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A whole-card link to a course. Cream feature-card surface; the entire tile
 * is the tap target. `footer` is for progress bars / badges.
 */
export function CourseCard({
  href,
  title,
  description,
  footer,
}: {
  href: string;
  title: string;
  description?: string | null;
  footer?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex h-full flex-col rounded-lg bg-surface-card p-5 transition-colors hover:bg-surface-cream-strong focus-visible:focus-ring sm:p-6"
    >
      <h2 className="font-sans text-lg font-medium tracking-normal text-ink">{title}</h2>
      {description && <p className="mt-1 line-clamp-2 text-sm text-muted">{description}</p>}
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </Link>
  );
}
