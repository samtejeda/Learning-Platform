"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Contract (backend-builder): POST /api/lectures/[id]/progress
//   body   { position: number, watchedSeconds: number, duration: number }
//   200 →  { watchedSeconds: number, completed: boolean, completionThreshold: number }
// The server validates the delta against wall-clock time and decides
// `completed`; the client only reflects what the server says.

export type ProgressSnapshot = { position: number; watchedSeconds: number; duration: number };
export type ProgressResult = { watchedSeconds: number; completed: boolean; completionThreshold: number };

const PING_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

export function useLectureProgress(opts: {
  lectureId: string;
  initialCompleted: boolean;
  /** Read the latest player state at send time. */
  getSnapshot: () => ProgressSnapshot | null;
  /** Called once when the server first reports completion. */
  onCompleted?: () => void;
}) {
  const { lectureId, initialCompleted, getSnapshot, onCompleted } = opts;
  const [completed, setCompleted] = useState(initialCompleted);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const inFlight = useRef(false);
  const failures = useRef(0);
  const nextAllowedAt = useRef(0);
  const lastSent = useRef<ProgressSnapshot | null>(null);
  const completedRef = useRef(initialCompleted);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  const send = useCallback(
    async (reason: "tick" | "pause" | "ended" | "hidden" | "unload") => {
      const snap = getSnapshot();
      if (!snap || !(snap.duration > 0)) return;
      // Nothing new to report (e.g. paused twice) — skip.
      if (
        lastSent.current &&
        reason !== "ended" &&
        Math.abs(lastSent.current.watchedSeconds - snap.watchedSeconds) < 0.5 &&
        Math.abs(lastSent.current.position - snap.position) < 0.5
      ) {
        return;
      }
      if (reason === "tick" && (inFlight.current || Date.now() < nextAllowedAt.current)) return;

      inFlight.current = true;
      try {
        const res = await fetch(`/api/lectures/${encodeURIComponent(lectureId)}/progress`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(snap),
          // Let the request finish even if the page is being closed.
          keepalive: reason === "unload" || reason === "hidden",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProgressResult;
        lastSent.current = snap;
        failures.current = 0;
        nextAllowedAt.current = 0;
        setSyncError(null);
        if (data.completed && !completedRef.current) {
          completedRef.current = true;
          setCompleted(true);
          onCompletedRef.current?.();
        }
      } catch {
        failures.current += 1;
        const backoff = Math.min(MAX_BACKOFF_MS, PING_INTERVAL_MS * 2 ** (failures.current - 1));
        nextAllowedAt.current = Date.now() + backoff;
        setSyncError("Your progress isn't saving right now. We'll keep trying — you can keep watching.");
      } finally {
        inFlight.current = false;
      }
    },
    [getSnapshot, lectureId],
  );

  // Periodic ping while playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => send("tick"), PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, send]);

  // Flush when the tab is hidden or the page is going away.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send("hidden");
    };
    const onPageHide = () => send("unload");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [send]);

  return {
    completed,
    syncError,
    /** Tell the hook whether the video is currently playing. */
    setPlaying,
    /** Force a ping now (pause / ended). */
    flush: send,
  };
}
