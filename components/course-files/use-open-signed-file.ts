"use client";

import { useState } from "react";

// The one tap-to-open pattern for private course files (syllabus PDF and
// file-kind materials). Nothing is fetched until the user taps; the endpoint
// returns { url, expiresAt } after the server has checked enrollment or
// ownership; the URL is opened in a new tab and never rendered into the page
// as an href, so it can't be copied past its short TTL.

export type OpenFileState = "idle" | "loading" | "error";

const MESSAGES: Record<number, string> = {
  401: "Your session has expired. Please sign in again.",
  404: "This file isn't available.",
  429: "Too many requests. Please wait a moment and try again.",
  503: "This file is unavailable right now. Please try again.",
};

export function useOpenSignedFile(endpoint: string) {
  const [state, setState] = useState<OpenFileState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(endpoint, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        setState("error");
        setError(MESSAGES[res.status] ?? "We couldn't load this file.");
        return;
      }
      const data = (await res.json()) as { url: string };
      setState("idle");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setState("error");
      setError("We couldn't load this file. Check your connection.");
    }
  }

  return { state, error, open };
}
