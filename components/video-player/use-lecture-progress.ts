"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeIntervals, type Interval } from "@/lib/progress/policy";
import type { ProgressView } from "@/lib/data/progress";
import {
  SegmentRecorder,
  classifyProgressStatus,
  enqueueSegment,
  nextBackoffMs,
  type ProgressSegment,
} from "@/lib/video/segments";

// Contract: POST /api/lectures/[id]/progress   (API.md)
//   body     { from, to, position? }      one short segment just played (≤ 20 s)
//   200 →    { accepted: true, percent, completed, watchedSeconds, intervals, justCompleted }
//            { accepted: false, reason: "too_fast" }   ignored, nothing credited
//   400/404/409 → never retry; 429/5xx/network → keep the segment and retry
// Percent, completion and the watched ranges shown in the UI ALWAYS come from
// the server's response, never from local arithmetic.

type ProgressResponse = {
  accepted: boolean;
  percent?: number;
  completed?: boolean;
  intervals?: Interval[];
};

export function useLectureProgress(opts: {
  lectureId: string;
  /** False for an instructor preview: nothing is recorded or sent. */
  tracksProgress: boolean;
  initial: ProgressView;
}) {
  const { lectureId, tracksProgress, initial } = opts;

  const [recorder] = useState(() => new SegmentRecorder());
  const [intervals, setIntervals] = useState<Interval[]>(() => mergeIntervals(initial.intervals));
  const [percent, setPercent] = useState(initial.percent);
  const [completed, setCompleted] = useState(initial.completed);
  const [syncError, setSyncError] = useState<string | null>(null);

  const queue = useRef<ProgressSegment[]>([]);
  const inFlight = useRef(false);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTime = useRef(initial.lastPositionSeconds);
  const drainRef = useRef<(unloading?: boolean) => Promise<void>>(async () => {});

  const drain = useCallback(
    async (unloading = false) => {
      if (!tracksProgress || inFlight.current) return;
      inFlight.current = true;
      try {
        while (queue.current.length > 0) {
          const seg = queue.current[0];
          let status = 0;
          let data: ProgressResponse | null = null;
          try {
            const res = await fetch(`/api/lectures/${encodeURIComponent(lectureId)}/progress`, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify(seg),
              // Let the request finish even while the page is going away.
              keepalive: unloading,
            });
            status = res.status;
            if (res.ok) data = (await res.json()) as ProgressResponse;
          } catch {
            status = 0;
          }

          const verdict = classifyProgressStatus(status);
          if (verdict === "retry") {
            failures.current += 1;
            setSyncError("Your progress isn't saving right now. We'll keep trying — you can keep watching.");
            if (retryTimer.current) clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => void drainRef.current(), nextBackoffMs(failures.current));
            return;
          }

          queue.current.shift();
          failures.current = 0;

          if (verdict === "drop") {
            if (status === 401) setSyncError("Your session has expired. Sign in again to keep saving progress.");
            else if (status === 409) setSyncError("This lecture isn't ready for progress tracking yet.");
            continue;
          }

          setSyncError(null);
          if (data?.accepted && data.intervals) {
            setIntervals(mergeIntervals(data.intervals));
            setPercent(data.percent ?? 0);
            if (data.completed) setCompleted(true);
          }
        }
      } finally {
        inFlight.current = false;
      }
    },
    [lectureId, tracksProgress],
  );

  useEffect(() => {
    drainRef.current = drain;
  }, [drain]);

  const push = useCallback(
    (seg: ProgressSegment | null, unloading = false) => {
      if (!tracksProgress || !seg) return;
      queue.current = enqueueSegment(queue.current, seg);
      void drain(unloading);
    },
    [drain, tracksProgress],
  );

  // Flush on tab-hide / page-hide, and when the player unmounts (navigating
  // to another lecture inside the app).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") push(recorder.flush(lastTime.current), true);
    };
    const onPageHide = () => push(recorder.close(lastTime.current), true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      push(recorder.close(lastTime.current), true);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [push, recorder]);

  // ── Called by the player's media events ───────────────────────────────────
  const onPlay = useCallback(
    (t: number) => {
      lastTime.current = t;
      if (tracksProgress) recorder.begin(t);
    },
    [recorder, tracksProgress],
  );
  const onPause = useCallback(
    (t: number) => {
      lastTime.current = t;
      push(recorder.close(t));
    },
    [push, recorder],
  );
  const onTimeUpdate = useCallback(
    (t: number) => {
      lastTime.current = t;
      push(recorder.tick(t));
    },
    [push, recorder],
  );
  /** A seek the player allowed: end the old stretch, resume recording at the target. */
  const onSeek = useCallback(
    (previousTime: number, target: number, playing: boolean) => {
      push(recorder.close(previousTime, target));
      lastTime.current = target;
      if (playing && tracksProgress) recorder.begin(target);
    },
    [push, recorder, tracksProgress],
  );

  return {
    intervals,
    percent,
    completed,
    syncError,
    onPlay,
    onPause,
    onEnded: onPause,
    onTimeUpdate,
    onSeek,
  };
}
