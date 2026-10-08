import Link from "next/link";

export type Crumb = { label: string; href?: string };

/**
 * The trail on wide screens only (`lg` and up): My courses › Course › … ›
 * current page. Real links; the last item is the current page and is marked
 * `aria-current="page"`; long titles truncate. Phones keep the Back link.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="hidden lg:block">
      <ol role="list" className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className={`flex items-center gap-1.5 ${last ? "min-w-0 shrink" : "min-w-0 shrink-[2]"}`}>
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 max-w-[16rem] items-center truncate rounded-md px-1 font-medium hover:text-ink hover:underline focus-visible:focus-ring"
                >
                  <span className="truncate">{item.label}</span>
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="inline-flex min-h-11 min-w-0 items-center px-1 font-medium text-ink">
                  <span className="truncate">{item.label}</span>
                </span>
              )}
              {!last && (
                <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 text-muted-soft" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
