"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/sentry/report-client-error";

// Last line of defence: renders when the ROOT LAYOUT itself throws, replacing
// it entirely. That means no app CSS or fonts are guaranteed to be loaded, so
// this page owns its own <html>/<body> and styles inline.
export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#faf9f5",
          color: "#1f1e1d",
          padding: "1.5rem",
        }}
      >
        <main style={{ maxWidth: "26rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.75rem", fontSize: "0.9rem", opacity: 0.7 }}>
            The site hit an unexpected problem and it has been reported. Please try again in a
            moment.
          </p>
          {error.digest && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", opacity: 0.5 }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.6rem 1.1rem",
              borderRadius: "0.5rem",
              border: "1px solid #c9c6bd",
              background: "#fff",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
