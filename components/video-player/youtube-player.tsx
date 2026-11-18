"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProgressView } from "@/lib/data/progress";
import { Alert } from "@/components/ui/alert";
import { ProgressBar } from "@/components/ui/progress-bar";
import { CompletionBanner } from "./completion-banner";
import { useLectureProgress } from "./use-lecture-progress";
import { useRefreshOnComplete } from "./use-refresh-on-complete";
import { POLL_MS, YoutubeTracker, exceedsCreditedSpeed, type ProgressSink } from "./youtube-adapter";
import { YoutubeEmbed, type YoutubeEmbedHandlers } from "./youtube-embed";
import { YOUTUBE_SOURCE_NOTE, speedNoticeText } from "./youtube-messages";

type Props = {
  lectureId: string;
  title: string;
  videoId: string;
  /** The server's duration (the denominator for completion); null if unknown. */
  durationSeconds: number | null;
  /** False for an instructor preview: the player works, nothing is recorded. */
  tracksProgress: boolean;
  initialProgress: ProgressView;
  next?: { href: string; title: string } | null;
};

/** Where to resume: the saved position, or the start if the lecture was finished before. */
function resumeAt(progress: ProgressView, durationSeconds: number | null): number {
  const t = progress.lastPositionSeconds;
  if (!(t > 0)) return 0;
  if (durationSeconds && (t >= durationSeconds - 1 || (progress.completed && t > durationSeconds - 3))) return 0;
  return t;
}

/**
 * A lecture that plays from YouTube. The player is YouTube's own, with its own
 * controls: YouTube's terms forbid overlays and blocking seeks, so there is no
 * seek lock and every notice sits OUTSIDE the player box. What we do is read
 * the player's position and report it through the same progress protocol the
 * uploaded-video player uses (useLectureProgress, 20 s segments, server-side
 * wall-clock bound); the server alone decides what counts and when the lecture
 * is complete.
 */
export function YoutubePlayer({ lectureId, title, videoId, durationSeconds, tracksProgress, initialProgress, next }: Props) {
  const progress = useLectureProgress({ lectureId, tracksProgress, initial: initialProgress });
  useRefreshOnComplete(progress.completed, tracksProgress);

  const [startSeconds] = useState(() => resumeAt(initialProgress, durationSeconds));
  const [rate, setRate] = useState(1);

  // The tracker outlives renders; it calls the latest progress callbacks.
  const sinkRef = useRef<ProgressSink>(progress);
  useEffect(() => {
    sinkRef.current = progress;
  });
  const trackerRef = useRef<YoutubeTracker | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handlers = useMemo<YoutubeEmbedHandlers>(
    () => ({
      onReady: (player) => {
        if (timerRef.current) clearInterval(timerRef.current);
        const sink: ProgressSink = {
          onPlay: (t) => sinkRef.current.onPlay(t),
          onPause: (t) => sinkRef.current.onPause(t),
          onTimeUpdate: (t) => sinkRef.current.onTimeUpdate(t),
          onSeek: (prev, target, playing) => sinkRef.current.onSeek(prev, target, playing),
        };
        const tracker = new YoutubeTracker(player, sink, Date.now, setRate);
        tracker.begin();
        trackerRef.current = tracker;
        timerRef.current = setInterval(() => tracker.poll(), POLL_MS);
      },
      onStateChange: (state) => trackerRef.current?.handleState(state),
      onRateChange: (r) => trackerRef.current?.handleRate(r),
    }),
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      trackerRef.current = null;
    },
    [],
  );

  return (
    <div className="space-y-4">
      <YoutubeEmbed
        videoId={videoId}
        startSeconds={startSeconds}
        handlers={handlers}
        bleed
        studentHelp
        label={`Video player: ${title}`}
      />

      {/* Everything below is outside the player box. */}
      <p className="text-sm text-muted">{YOUTUBE_SOURCE_NOTE}</p>

      {tracksProgress && exceedsCreditedSpeed(rate) && <Alert tone="warning">{speedNoticeText(rate)}</Alert>}

      {progress.syncError && <Alert tone="warning">{progress.syncError}</Alert>}

      {tracksProgress &&
        (progress.completed ? (
          <CompletionBanner next={next} />
        ) : (
          <ProgressBar value={progress.percent} label="Lecture progress" caption={`${progress.percent}% watched`} />
        ))}
    </div>
  );
}
