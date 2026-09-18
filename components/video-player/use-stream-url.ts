"use client";

import { useCallback, useEffect, useState } from "react";

// Contract (backend-builder): GET /api/lectures/[id]/stream
//   200 → { url: string, expiresAt: string (ISO) }   enrollment-checked, short TTL
//   401/403/404 → { error: { code, message } }

type State =
  | { status: "loading"; url: null }
  | { status: "ready"; url: string; expiresAt: number }
  | { status: "error"; url: null; message: string };

const REFRESH_LEAD_MS = 60_000;
const MIN_REFRESH_WAIT_MS = 5_000;

/**
 * Fetches a signed playback URL for the lecture and refreshes it shortly
 * before it expires (and on demand when the <video> reports an error).
 *
 * `version` drives the effect: bumping it re-runs the fetch. The expiry
 * timer and `refresh()` both just bump it, so all fetching lives in one
 * effect with proper cancellation.
 */
export function useStreamUrl(lectureId: string) {
  const [state, setState] = useState<State>({ status: "loading", url: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    fetch(`/api/lectures/${encodeURIComponent(lectureId)}/stream`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          setState({
            status: "error",
            url: null,
            message: body?.error?.message ?? "We couldn't load this video.",
          });
          return;
        }
        const data = (await res.json()) as { url: string; expiresAt: string };
        if (cancelled) return;
        const expiresAt = Date.parse(data.expiresAt);
        setState({ status: "ready", url: data.url, expiresAt });
        const wait = Math.max(MIN_REFRESH_WAIT_MS, expiresAt - Date.now() - REFRESH_LEAD_MS);
        timer = setTimeout(() => setVersion((v) => v + 1), wait);
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          status: "error",
          url: null,
          message: "We couldn't load this video. Check your connection.",
        });
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [lectureId, version]);

  return { ...state, refresh };
}
