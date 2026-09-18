"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  applyTimeUpdate,
  clampSeek,
  frontier as frontierOf,
  intervalsFromWatchedSeconds,
  isSeekAllowed,
  totalWatched,
  type Interval,
} from "@/lib/video/watch-tracker";
import { formatTime } from "@/lib/video/format-time";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useStreamUrl } from "./use-stream-url";
import { useLectureProgress } from "./use-lecture-progress";

type Props = {
  lectureId: string;
  title: string;
  /** From the server's lecture_progress row. */
  initialWatchedSeconds: number;
  initialCompleted: boolean;
  /** Fires once when the server first marks the lecture complete. */
  onCompleted?: () => void;
};

const SKIP_SECONDS = 10;

/**
 * Custom HTML5 player with no native controls. Anti-scrub rules (client
 * side; the server re-validates every ping):
 *   - forward seeks past the watched frontier snap back
 *   - playback rate is pinned to 1×
 *   - once the server says "completed", seeking is unlocked for rewatching
 */
export function VideoPlayer({ lectureId, title, initialWatchedSeconds, initialCompleted, onCompleted }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const intervals = useRef<Interval[]>(intervalsFromWatchedSeconds(initialWatchedSeconds));
  const lastTime = useRef(0);
  const resumedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [frontier, setFrontier] = useState(initialWatchedSeconds);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stream = useStreamUrl(lectureId);

  const getSnapshot = useCallback(() => {
    const v = videoRef.current;
    if (!v || !(v.duration > 0)) return null;
    return { position: v.currentTime, watchedSeconds: totalWatched(intervals.current), duration: v.duration };
  }, []);

  const progress = useLectureProgress({ lectureId, initialCompleted, getSnapshot, onCompleted });
  const unlocked = progress.completed;

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }, []);

  // ── media event handlers ────────────────────────────────────────────────
  const onLoadedMetadata = () => {
    const v = videoRef.current!;
    setDuration(v.duration);
    // Resume at the frontier on first load; on a URL refresh keep position.
    if (!resumedRef.current) {
      resumedRef.current = true;
      if (!unlocked && initialWatchedSeconds > 0 && initialWatchedSeconds < v.duration) {
        v.currentTime = initialWatchedSeconds;
        lastTime.current = initialWatchedSeconds;
      }
    } else if (pendingResume.current != null) {
      v.currentTime = pendingResume.current;
      lastTime.current = pendingResume.current;
      pendingResume.current = null;
    }
  };

  const onTimeUpdate = () => {
    const v = videoRef.current!;
    const t = v.currentTime;
    if (!v.paused && !v.seeking) {
      intervals.current = applyTimeUpdate(intervals.current, lastTime.current, t);
      const f = frontierOf(intervals.current);
      if (f !== frontier) setFrontier(f);
    }
    lastTime.current = t;
    setCurrent(t);
  };

  const onSeeking = () => {
    const v = videoRef.current!;
    if (unlocked) return;
    const f = frontierOf(intervals.current);
    if (!isSeekAllowed(v.currentTime, f)) {
      v.currentTime = clampSeek(v.currentTime, f);
      showNotice("You can't skip ahead yet — keep watching to unlock the rest.");
    }
    lastTime.current = v.currentTime;
  };

  const onRateChange = () => {
    const v = videoRef.current!;
    if (v.playbackRate !== 1) v.playbackRate = 1;
  };

  const onPlay = () => {
    setIsPlaying(true);
    progress.setPlaying(true);
  };
  const onPause = () => {
    setIsPlaying(false);
    progress.setPlaying(false);
    progress.flush("pause");
  };
  const onEnded = () => {
    setIsPlaying(false);
    progress.setPlaying(false);
    progress.flush("ended");
  };

  // Signed URL expired mid-session → fetch a fresh one and resume in place.
  const pendingResume = useRef<number | null>(null);
  const onError = () => {
    const v = videoRef.current;
    if (v && v.currentTime > 0) pendingResume.current = v.currentTime;
    stream.refresh();
  };

  // ── controls ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const seekTo = useCallback(
    (target: number) => {
      const v = videoRef.current;
      if (!v || !(v.duration > 0)) return;
      const clamped = Math.max(0, Math.min(v.duration, target));
      const f = frontierOf(intervals.current);
      if (!unlocked && !isSeekAllowed(clamped, f)) {
        v.currentTime = f;
        showNotice("You can't skip ahead yet — keep watching to unlock the rest.");
      } else {
        v.currentTime = clamped;
      }
      lastTime.current = v.currentTime;
      setCurrent(v.currentTime);
    },
    [unlocked, showNotice],
  );

  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const onTrackPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el || !(duration > 0)) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const onButton = target.tagName === "BUTTON";
    switch (e.key) {
      case " ":
        if (onButton) return; // let the button handle its own activation
        e.preventDefault();
        togglePlay();
        break;
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "m":
        e.preventDefault();
        toggleMute();
        break;
      case "f":
        e.preventDefault();
        toggleFullscreen();
        break;
      case "ArrowLeft":
        e.preventDefault();
        seekTo(current - SKIP_SECONDS);
        break;
      case "ArrowRight":
        e.preventDefault();
        seekTo(current + SKIP_SECONDS);
        break;
      case "Home":
        e.preventDefault();
        seekTo(0);
        break;
    }
  };

  const playedPct = duration > 0 ? (current / duration) * 100 : 0;
  const watchedPct = duration > 0 ? Math.min(100, (frontier / duration) * 100) : 0;
  const controlBtn =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-on-dark hover:bg-surface-dark-elevated focus-visible:focus-ring";

  const streamError = stream.status === "error" ? stream.message : null;
  const valueText = useMemo(() => `${formatTime(current)} of ${formatTime(duration)}`, [current, duration]);

  return (
    <div className="space-y-3">
      <div
        ref={wrapperRef}
        onKeyDown={onKeyDown}
        className={`group relative overflow-hidden bg-surface-dark text-on-dark ${
          fullscreen ? "flex h-full w-full flex-col justify-center" : "-mx-4 sm:mx-0 sm:rounded-lg"
        }`}
        aria-label={`Video player: ${title}`}
        role="region"
      >
        <div className="relative aspect-video w-full bg-black">
          {stream.url && (
            <video
              ref={videoRef}
              src={stream.url}
              className="absolute inset-0 h-full w-full"
              playsInline
              preload="metadata"
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload noplaybackrate noremoteplayback"
              onContextMenu={(e) => e.preventDefault()}
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              onSeeking={onSeeking}
              onRateChange={onRateChange}
              onPlay={onPlay}
              onPause={onPause}
              onEnded={onEnded}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => setBuffering(false)}
              onCanPlay={() => setBuffering(false)}
              onError={onError}
              onClick={togglePlay}
            />
          )}

          {/* Centre state: loading / error / big play */}
          {stream.status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-on-dark-soft" aria-live="polite">
              Loading video…
            </div>
          )}
          {streamError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-on-dark-soft">{streamError}</p>
              <Button variant="secondary" size="sm" onClick={() => stream.refresh()}>
                Try again
              </Button>
            </div>
          )}
          {stream.url && !isPlaying && !streamError && (
            <button
              type="button"
              onClick={togglePlay}
              aria-label={current > 0 ? "Resume" : "Play"}
              className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-primary text-on-primary shadow-sheet hover:bg-primary-active focus-visible:focus-ring"
            >
              <PlayIcon className="size-7 translate-x-0.5" />
            </button>
          )}
          {buffering && isPlaying && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="size-10 animate-spin rounded-full border-2 border-on-dark/30 border-t-on-dark" aria-hidden />
              <span className="sr-only">Buffering</span>
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="absolute inset-x-4 bottom-20 mx-auto max-w-sm rounded-md bg-surface-dark-elevated/95 px-3.5 py-2 text-center text-sm text-on-dark"
            >
              {notice}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-1 px-2 pb-2 pt-1 sm:px-3">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Position"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(current)}
            aria-valuetext={valueText}
            onPointerDown={onTrackPointer}
            className="relative h-6 cursor-pointer touch-none rounded-sm focus-visible:focus-ring"
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-pill bg-on-dark/20">
              {/* watched frontier */}
              <div className="absolute inset-y-0 left-0 rounded-pill bg-on-dark/35" style={{ width: `${watchedPct}%` }} />
              {/* played */}
              <div className="absolute inset-y-0 left-0 rounded-pill bg-primary" style={{ width: `${playedPct}%` }} />
            </div>
            <div
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-dark"
              style={{ left: `${playedPct}%` }}
              aria-hidden
            />
          </div>

          <div className="flex items-center gap-1">
            <button type="button" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} className={controlBtn}>
              {isPlaying ? <PauseIcon className="size-5" /> : <PlayIcon className="size-5" />}
            </button>
            <button type="button" onClick={() => seekTo(current - SKIP_SECONDS)} aria-label="Back 10 seconds" className={controlBtn}>
              <BackIcon className="size-5" />
            </button>
            <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} className={controlBtn}>
              {muted ? <MutedIcon className="size-5" /> : <VolumeIcon className="size-5" />}
            </button>
            <span className="ml-1 text-xs tabular-nums text-on-dark-soft sm:text-sm" aria-hidden>
              {formatTime(current)} <span className="text-on-dark/40">/</span> {formatTime(duration)}
            </span>
            <span className="flex-1" />
            {unlocked && (
              <span className="hidden text-xs text-on-dark-soft sm:inline" title="You've completed this lecture; you can now skip freely.">
                Completed
              </span>
            )}
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              className={controlBtn}
            >
              <FullscreenIcon className="size-5" />
            </button>
          </div>
        </div>
      </div>

      {progress.syncError && <Alert tone="warning">{progress.syncError}</Alert>}
    </div>
  );
}

// ── icons (inline so nothing extra loads) ───────────────────────────────────
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M7 4.5v15l12-7.5z" />
    </svg>
  );
}
function PauseIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z" />
    </svg>
  );
}
function BackIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 5a7 7 0 1 1-6.3 4" />
      <path d="M5 4v5h5" />
      <text x="8.6" y="15.5" fontSize="6.5" fontWeight="600" fill="currentColor" stroke="none">10</text>
    </svg>
  );
}
function VolumeIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 9v6h3l4 3.5V5.5L7 9z" fill="currentColor" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
    </svg>
  );
}
function MutedIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 9v6h3l4 3.5V5.5L7 9z" fill="currentColor" />
      <path d="M15 9.5l5 5M20 9.5l-5 5" />
    </svg>
  );
}
function FullscreenIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </svg>
  );
}
