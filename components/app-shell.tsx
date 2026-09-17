import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";
import { SignOutButton } from "./sign-out-button";

const NAV: Record<CurrentUser["role"], { href: string; label: string }[]> = {
  student: [{ href: "/dashboard", label: "My courses" }],
  professor: [{ href: "/professor", label: "My courses" }],
  admin: [
    { href: "/admin", label: "Admin" },
    { href: "/professor", label: "Courses" },
  ],
};

/**
 * Minimal authenticated chrome: app name, role-aware nav, sign-out.
 * Intentionally unstyled beyond structure; the DESIGN.md pass comes later.
 */
export function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between gap-4">
          <Link href={homeForRole(user.role)} className="font-semibold text-slate-900">
            Learning Platform
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3 text-sm">
            {NAV[user.role].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-2 py-1.5 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
            <span className="hidden sm:inline text-slate-400" aria-hidden>
              |
            </span>
            <span className="hidden sm:inline text-slate-500 truncate max-w-40">
              {user.fullName ?? user.email ?? "Account"}
            </span>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
