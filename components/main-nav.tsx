"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

export type NavItem = { href: string; label: string };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Role-aware navigation. Desktop (md+): inline links. Phones: a "Menu"
 * button opens a full-screen cream sheet (DESIGN.md "Collapsing Strategy")
 * built on a native <dialog>, which gives us focus trapping, Escape-to-close
 * and correct screen-reader semantics without a dependency.
 *
 * `account` is the user's display name; `children` is the sign-out form
 * (a server component passed through as a slot).
 */
export function MainNav({
  items,
  account,
  children,
}: {
  items: NavItem[];
  account: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Close the sheet whenever navigation happens.
  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  const linkBase =
    "inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:focus-ring";

  return (
    <nav aria-label="Main" className="flex items-center gap-2">
      {/* Desktop */}
      <ul className="hidden items-center gap-1 md:flex">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`${linkBase} ${active ? "bg-surface-card text-ink" : "text-muted hover:bg-surface-soft hover:text-ink"}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden items-center gap-3 md:flex">
        <span className="max-w-40 truncate text-sm text-muted" title={account}>
          {account}
        </span>
        {children}
      </div>

      {/* Phone */}
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex size-10 items-center justify-center rounded-md text-ink hover:bg-surface-soft focus-visible:focus-ring md:hidden"
        aria-label="Open menu"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Menu"
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-canvas p-0 text-body backdrop:bg-transparent open:flex open:flex-col"
      >
        <div className="flex h-14 items-center justify-between border-b border-hairline px-4">
          <span className="font-display text-xl font-semibold tracking-tight text-ink">Menu</span>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="inline-flex size-10 items-center justify-center rounded-md text-ink hover:bg-surface-soft focus-visible:focus-ring"
            aria-label="Close menu"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <ul className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 items-center rounded-md px-4 font-display text-2xl tracking-tight focus-visible:focus-ring ${
                    active ? "bg-surface-card text-ink" : "text-body hover:bg-surface-soft"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="space-y-3 border-t border-hairline px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="truncate text-sm text-muted">Signed in as {account}</p>
          {children}
        </div>
      </dialog>
    </nav>
  );
}
