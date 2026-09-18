import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Link href="/" className="rounded-md focus-visible:focus-ring">
            <Wordmark />
          </Link>
        </div>
        {children}
      </div>
    </main>
  );
}
