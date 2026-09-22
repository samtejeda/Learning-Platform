"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ProgressView } from "@/lib/data/progress";
import { canSeek } from "@/lib/video/segments";
import { formatTime } from "@/lib/video/format-time";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { CompletionBanner } from "./completion-banner";
import { useLectureProgress } from "./use-lecture-progress";
import { useStreamUrl } from "./use-stream-url";

type Props = {
  lectureId: string;
  title: string;
  /** The server's duration (the denominator for completion); null if unknown. */
  durationSeconds: number | null;
  /** False for an instructor preview: no progress is recorded, seeking is free. */
  tracksProgress: boolean;
  initialProgress: ProgressView;
  /** Shown in the completion banner. */
  next?: { href: string; title: string } | null;
};

const SKIP_SECONDS = 10;
const SEEK_DENIED = "You can't skip ahead yet — keep watching to unlock the rest.";
const MAX_MEDIA_RETRIES = 2;

/**
 * Custom HTML5 player with no native controls. Client-side rules (the
 * server re-validates every ping and is the only authority on completion):
 *   - forward seeks into unwatched video snap back until the lecture is
 *     complete (then everything unlocks for rewatching)
 *   - playback rate is pinned to 1×
 *   - what counts as "watched", the percentage and completion are shown
 *     exactly as the server reports them
 */
export function VideoPlayer({ lectureId, title, durationSeconds, tracksProgress, initialProgress, next }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const lastTime = useRef(initialProgress.lastPositionSeconds);
  const resumedRef = useRef(false);
  const pendingResume = useRef<{ time: number; play: boolean } | null>(null);
  const mediaRetries = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(initialProgress.lastPositionSeconds);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const stream = useStreamUrl(lectureId);
  const progress = useLectureProgress({ lectureId, tracksProgress, initial: initialProgress });
  const unlocked = !tracksProgress || progress.completed;

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const setTime = (v: HTMLVideoElement, t: number) => {
    // Update our reference point first so the resulting `seeking` event
    // reads as "not a forward jump".
    lastTime.current = t;
    v.currentTime = t;
    setCurrent(t);
  };

  // ── media events ────────────────────────────────────────────────────────
  const onLoadedMetadata = () => {
    const v = videoRef.current!;
    if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);

    // A refreshed URL: put the playhead back where it was.
    const pending = pendingResume.current;
    if (pending) {
      pendingResume.current = null;
      setTime(v, pending.time);
      if (pending.play) v.play().catch(() => {});
      return;
    }

    // First load: resume where the server says the student left off.
    if (!resumedRef.current) {
      resumedRef.current = true;
      let t = initialProgress.lastPositionSeconds;
      if (initialProgress.completed && t > v.duration - 3) t = 0; // finished before: start over
      if (t > 0 && t < v.duration - 1) setTime(v, t);
    }
  };

  const onTimeUpdate = () => {
    const v = videoRef.current!;
    if (v.seeking) return;
    const t = v.currentTime;
    lastTime.current = t;
    setCurrent(t);
    progress.onTimeUpdate(t);
  };

  const onSeeking = () => {
    const v = videoRef.current!;
    const target = v.currentTime;
    const previous = lastTime.current;
    if (!canSeek({ target, previousTime: previous, intervals: progress.intervals, unlocked })) {
      v.currentTime = previous; // snap back
      showNotice(SEEK_DENIED);
      return;
    }
    progress.onSeek(previous, target, !v.paused);
    lastTime.current = target;
    setCurrent(target);
  };

  const onRateChange = () => {
    const v = videoRef.current!;
    if (v.playbackRate !== 1) v.playbackRate = 1;
  };

  const onPlay = () => {
    setIsPlaying(true);
    progress.onPlay(videoRef.current!.currentTime);
  };
  const onPause = () => {
    setIsPlaying(false);
    progress.onPause(videoRef.current!.currentTime);
  };
  const onEnded = () => {
    setIsPlaying(false);
    progress.onEnded(videoRef.current!.currentTime);
  };

  // An expired signed URL fails the next range request: fetch a fresh one
  // and resume in place. Capped so a genuinely undecodable file can't loop.
  const onError = () => {
    const v = videoRef.current;
    if (mediaRetries.current >= MAX_MEDIA_RETRIES) {
      setMediaError("This video couldn't be played. Try again later, or tell your professor.");
      return;
    }
    mediaRetries.current += 1;
    pendingResume.current = { time: v?.currentTime ?? lastTime.current, play: v ? !v.paused : false };
    stream.refresh();
  };

  const retryLoad = () => {
    mediaRetries.current = 0;
    setMediaError(null);
    stream.refresh();
  };

  // ── controls ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      return;
    }
    // About to expire? Get a fresh URL first; playback resumes on load.
    if (stream.status === "ready" && Date.now() > stream.expiresAt - 30_000) {
      pendingResume.current = { time: v.currentTime, play: true };
      stream.refresh();
      return;
    }
    v.play().catch(() => {});
  }, [stream]);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const seekTo = (target: number) => {
    const v = videoRef.current;
    if (!v || !(v.duration > 0)) return;
    // `onSeeking` enforces the rules; this only clamps to the media range.
    v.currentTime = Math.max(0, Math.min(v.duration, target));
  };

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
    seekTo(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const onButton = (e.target as HTMLElement).tagName === "BUTTON";
    switch (e.key) {
      case " ":
        if (onButton) return; // let the focused button handle its own activation
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

  const playedPct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const controlBtn =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-on-dark hover:bg-surface-dark-elevated focus-visible:focus-ring";
  const loadError = stream.status === "error" ? stream.message : mediaError;

  return (
    <div className="space-y-4">
      <div
        ref={wrapperRef}
        onKeyDown={onKeyDown}
        role="region"
        aria-label={`Video player: ${title}`}
        className={`relative overflow-hidden bg-surface-dark text-on-dark ${
          fullscreen ? "flex h-full w-full flex-col justify-center" : "-mx-4 sm:mx-0 sm:rounded-lg"
        }`}
      >
        <div className="relative aspect-video w-full bg-black">
          {stream.url && !mediaError && (
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
              onCanPlay={() => {
                setBuffering(false);
                mediaRetries.current = 0;
              }}
              onError={onError}
              onClick={togglePlay}
            />
          )}

          {stream.status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-on-dark-soft" aria-live="polite">
              Loading video…
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-on-dark-soft">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={retryLoad}>
                Try again
              </Button>
            </div>
          )}
          {stream.url && !isPlaying && !loadError && (
            <button
              type="button"
              onClick={togglePlay}
              // The control bar's Play is the keyboard/screen-reader path;
              // this large target is for touch and mouse.
              tabIndex={-1}
              aria-label={duration > 0 && current >= duration - 1 ? "Replay" : current > 0 ? "Resume" : "Play"}
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
              className="absolute inset-x-4 bottom-4 mx-auto max-w-sm rounded-md bg-surface-dark-elevated/95 px-3.5 py-2 text-center text-sm text-on-dark"
            >
              {notice}
            </div>
          )}
        </div>

        <div className="space-y-1 px-2 pb-2 pt-1 sm:px-3">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Position"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(current)}
            aria-valuetext={`${formatTime(current)} of ${formatTime(duration)}`}
            onPointerDown={onTrackPointer}
            className="relative h-6 cursor-pointer touch-none rounded-sm focus-visible:focus-ring"
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-pill bg-on-dark/20">
              {/* Ranges the SERVER has accepted as watched. */}
              {tracksProgress &&
                duration > 0 &&
                progress.intervals.map(([s, e]) => (
                  <div
                    key={`${s}-${e}`}
                    className="absolute inset-y-0 rounded-pill bg-on-dark/35"
                    style={{ left: `${(s / duration) * 100}%`, width: `${((e - s) / duration) * 100}%` }}
                  />
                ))}
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

      {tracksProgress &&
        (progress.completed ? (
          <CompletionBanner next={next} />
        ) : (
          <ProgressBar
            value={progress.percent}
            label="Lecture progress"
            caption={`${progress.percent}% watched`}
          />
        ))}
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
      <text x="8.6" y="15.5" fontSize="6.5" fontWeight="600" fill="currentColor" stroke="none">
        10
      </text>
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
