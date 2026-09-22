import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { buttonClassName } from "@/components/ui/button";

export const metadata = { title: "Not found" };

/** Root 404 (no session context, so no app shell). */
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12 text-center">
      <Wordmark />
      <p className="mt-10 text-sm font-medium uppercase tracking-[1.5px] text-muted">404</p>
      <h1 className="mt-2 text-[2rem] sm:text-4xl">We couldn&apos;t find that page</h1>
      <Link href="/" className={buttonClassName("secondary", false, "md", "mt-8")}>
        Go to the home page
      </Link>
    </main>
  );
}
