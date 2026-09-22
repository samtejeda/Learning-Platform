import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";
import { MainNav, type NavItem } from "./main-nav";
import { SignOutButton } from "./sign-out-button";
import { Wordmark } from "./wordmark";

const NAV: Record<CurrentUser["role"], NavItem[]> = {
  student: [{ href: "/dashboard", label: "My courses" }],
  professor: [{ href: "/professor", label: "Teaching" }],
  admin: [
    { href: "/admin", label: "Admin" },
    { href: "/professor", label: "Courses" },
  ],
};

/**
 * Authenticated chrome: skip link, sticky cream top bar (DESIGN.md top-nav,
 * hairline bottom), role-aware nav, content column. The main column is
 * max-w-5xl so long-form course text stays at a readable measure.
 */
export function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const account = user.fullName ?? user.email ?? "Account";
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-dark"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:h-16">
          <Link href={homeForRole(user.role)} className="rounded-md focus-visible:focus-ring">
            <Wordmark />
          </Link>
          <MainNav items={NAV[user.role]} account={account}>
            <SignOutButton />
          </MainNav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
