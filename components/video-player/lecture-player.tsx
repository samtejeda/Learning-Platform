"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isWatched, MAX_SEGMENT_SECONDS, mergeIntervals, type Interval } from "@/lib/progress/policy";
import type { ProgressView } from "@/lib/data/progress";

/**
 * Minimal anti-scrub player. Load-bearing behaviour (keep when restyling):
 *  - <video> has NO native controls; play/pause/mute/fullscreen are ours.
 *  - The signed stream URL comes from GET /api/lectures/[id]/stream and is
 *    refetched when it expires or the media errors.
 *  - Seeking is only allowed into ranges the SERVER has already accepted as
 *    watched (`intervals`); any other seek snaps back.
 *  - While playing, every ~10 s (and on pause/seek/end/tab-hide) the player
 *    POSTs the segment it just played to /api/lectures/[id]/progress. The
 *    server decides what counts; percent/completed shown here always come
 *    from its response, never from local arithmetic.
 * Everything visual is fair game for the frontend pass.
 */
export function LecturePlayer({
  lectureId,
  durationSeconds,
  tracksProgress,
  initialProgress,
}: {
  lectureId: string;
  durationSeconds: number | null;
  tracksProgress: boolean;
  initialProgress: ProgressView;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialProgress.lastPositionSeconds);
  const [intervals, setIntervals] = useState<Interval[]>(() => mergeIntervals(initialProgress.intervals));
  const [percent, setPercent] = useState(initialProgress.percent);
  const [completed, setCompleted] = useState(initialProgress.completed);

  // The start of the segment currently being played (null when not playing).
  const segmentStart = useRef<number | null>(null);
  const lastKnownTime = useRef<number>(initialProgress.lastPositionSeconds);
  const resumed = useRef(false);
  const intervalsRef = useRef(intervals);
  useEffect(() => {
    intervalsRef.current = intervals;
  }, [intervals]);

  const duration = durationSeconds ?? 0;

  const fetchStreamUrl = useCallback((): Promise<void> => {
    // Promise chain rather than async/await: every state update happens in
    // a callback, never synchronously inside the effect that kicks this off.
    return fetch(`/api/lectures/${lectureId}/stream`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          setLoadError(res.status === 429 ? "Too many requests. Please wait a moment." : "This video isn't available.");
          return;
        }
        const data = (await res.json()) as { url: string; expiresAt: string };
        setLoadError(null);
        setSrc(data.url);
        setExpiresAt(new Date(data.expiresAt).getTime());
      })
      .catch(() => setLoadError("This video isn't available."));
  }, [lectureId]);

  useEffect(() => {
    void fetchStreamUrl();
  }, [fetchStreamUrl]);

  const flush = useCallback(
    async (to: number, position?: number) => {
      const from = segmentStart.current;
      segmentStart.current = null;
      if (!tracksProgress || from === null || to - from < 0.5) return;
      // Never claim more than the server accepts in one ping.
      const body = { from: Math.max(from, to - MAX_SEGMENT_SECONDS), to, position: position ?? to };
      try {
        const res = await fetch(`/api/lectures/${lectureId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          accepted: boolean;
          percent?: number;
          completed?: boolean;
          intervals?: Interval[];
        };
        if (data.accepted && data.intervals) {
          setIntervals(mergeIntervals(data.intervals));
          setPercent(data.percent ?? 0);
          setCompleted(!!data.completed);
        }
      } catch {
        // Network blip: the segment is lost, the student just rewatches it.
      }
    },
    [lectureId, tracksProgress],
  );

  // ── Media events ────────────────────────────────────────────────────────
  function onLoadedMetadata() {
    const v = videoRef.current;
    if (!v || resumed.current) return;
    resumed.current = true;
    const t = Math.min(initialProgress.lastPositionSeconds, Math.max(0, v.duration - 1));
    if (t > 0) {
      lastKnownTime.current = t;
      v.currentTime = t;
    }
  }

  function onPlay() {
    setPlaying(true);
    segmentStart.current = videoRef.current?.currentTime ?? 0;
  }

  function onPause() {
    setPlaying(false);
    const v = videoRef.current;
    if (v) void flush(v.currentTime);
  }

  function onEnded() {
    setPlaying(false);
    const v = videoRef.current;
    if (v) void flush(v.currentTime);
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    setCurrentTime(t);
    if (segmentStart.current !== null && t - segmentStart.current >= 10) {
      const to = t;
      void flush(to);
      segmentStart.current = to;
    }
    lastKnownTime.current = t;
  }

  function onSeeking() {
    const v = videoRef.current;
    if (!v) return;
    const target = v.currentTime;
    const allowed =
      !tracksProgress || target <= lastKnownTime.current + 0.5 || isWatched(intervalsRef.current, target);
    if (!allowed) {
      // Snap back: forward seeks into unwatched material aren't allowed.
      v.currentTime = lastKnownTime.current;
      return;
    }
    // A legitimate seek ends the current segment at the old position.
    const from = segmentStart.current;
    if (from !== null) {
      segmentStart.current = null;
      void flush(Math.max(from, Math.min(lastKnownTime.current, from + MAX_SEGMENT_SECONDS)), target);
    }
    lastKnownTime.current = target;
    if (!v.paused) segmentStart.current = target;
  }

  async function onMediaError() {
    // Most likely an expired signed URL; refetch once and resume.
    const v = videoRef.current;
    const at = v?.currentTime ?? lastKnownTime.current;
    await fetchStreamUrl();
    if (v) v.currentTime = at;
  }

  // Flush when the tab is hidden or the component unmounts. `flush` is
  // reached through a ref so the effect doesn't re-subscribe (or re-run its
  // cleanup) every time the callback identity changes.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => {
    const video = videoRef.current;
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        const v = videoRef.current;
        if (v && !v.paused) {
          void flushRef.current(v.currentTime);
          segmentStart.current = v.currentTime;
        }
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (video) void flushRef.current(video.currentTime);
    };
  }, []);

  // ── Controls ────────────────────────────────────────────────────────────
  async function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (Date.now() > expiresAt - 30_000) await fetchStreamUrl();
    if (v.paused) {
      try {
        await v.play();
      } catch {
        /* autoplay policy; user will tap again */
      }
    } else {
      v.pause();
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function fullscreen() {
    const el = videoRef.current?.parentElement;
    if (el?.requestFullscreen) void el.requestFullscreen();
  }

  function onBarClick(e: React.MouseEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * duration; // onSeeking enforces the watched-range rule
  }

  const pct = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
        {src ? (
          <video
            ref={videoRef}
            src={src}
            className="w-full h-full"
            playsInline
            preload="metadata"
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            onLoadedMetadata={onLoadedMetadata}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
            onTimeUpdate={onTimeUpdate}
            onSeeking={onSeeking}
            onError={() => void onMediaError()}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-300">
            {loadError ?? "Loading…"}
          </div>
        )}
      </div>

      {/* Progress bar: watched ranges are highlighted; clicks elsewhere snap back. */}
      <div
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        onClick={onBarClick}
        className="relative h-2 rounded bg-slate-200 cursor-pointer"
      >
        {duration > 0 &&
          intervals.map(([s, e]) => (
            <div
              key={`${s}-${e}`}
              className="absolute top-0 h-full bg-slate-400"
              style={{ left: `${(s / duration) * 100}%`, width: `${((e - s) / duration) * 100}%` }}
            />
          ))}
        <div className="absolute top-0 h-full w-0.5 bg-slate-900" style={{ left: `${pct}%` }} />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <button type="button" onClick={togglePlay} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white" disabled={!src}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={toggleMute} className="px-3 py-1.5 rounded-lg border border-slate-200" disabled={!src}>
          {muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" onClick={fullscreen} className="px-3 py-1.5 rounded-lg border border-slate-200" disabled={!src}>
          Fullscreen
        </button>
        <span className="ml-auto tabular-nums text-slate-500">
          {fmt(currentTime)} / {fmt(duration)}
        </span>
      </div>

      {tracksProgress && (
        <p className="text-sm text-slate-600" aria-live="polite">
          {completed ? "Completed ✓" : `${percent}% watched`}
        </p>
      )}
    </div>
  );
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}
