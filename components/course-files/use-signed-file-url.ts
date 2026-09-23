"use client";

import { useCallback, useEffect, useState } from "react";

// Same pattern as components/video-player/use-stream-url.ts, generalised to
// any endpoint returning { url, expiresAt }: the syllabus route and the
// course-material route both share this contract. Fetched once and
// re-fetched only on demand via refresh() — never on a timer.

type State =
  | { status: "loading"; url: null }
  | { status: "ready"; url: string; expiresAt: number }
  | { status: "error"; url: null; message: string };

const MESSAGES: Record<number, string> = {
  401: "Your session has expired. Please sign in again.",
  404: "This file isn't available.",
  429: "Too many requests. Please wait a moment and try again.",
  503: "That file is unavailable right now. Please try again.",
};

export function useSignedFileUrl(endpoint: string) {
  const [state, setState] = useState<State>({ status: "loading", url: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;

    fetch(endpoint, { method: "GET", headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({
            status: "error",
            url: null,
            message: MESSAGES[res.status] ?? "We couldn't load this file.",
          });
          return;
        }
        const data = (await res.json()) as { url: string; expiresAt: string };
        if (cancelled) return;
        setState({ status: "ready", url: data.url, expiresAt: Date.parse(data.expiresAt) });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          status: "error",
          url: null,
          message: "We couldn't load this file. Check your connection.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, version]);

  return { ...state, refresh };
}
