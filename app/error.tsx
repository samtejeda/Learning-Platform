"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/sentry/report-client-error";

// Root-level error boundary: catches render errors in any segment that has no
// closer error.tsx (today that includes the signed-out auth pages). It sits
// inside the root layout, so it can use normal page styling. Plain utilities
// only; the design pass can restyle it.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md p-6 pt-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-sm opacity-70">
        The problem has been reported. Please try again, and if it keeps happening let your
        professor or the administrator know.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs opacity-50">Reference: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg border px-4 py-2 text-sm font-medium"
      >
        Try again
      </button>
    </div>
  );
}
