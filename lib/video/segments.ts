// Pure client-side helpers for the segment-based progress protocol. No DOM,
// no React. The server (lib/progress/policy.ts) is the authority on what
// counts as watched; this module only decides *what to report* and *which
// seeks to allow in the UI*.
//
// Protocol: the player reports short "I just played from A to B" segments.
// The server rejects anything over MAX_SEGMENT_SECONDS and bounds how fast
// coverage may grow by wall-clock time, so the client never claims more than
// it actually played and never batches several segments into one burst.

import { MAX_SEGMENT_SECONDS, isWatched, type Interval } from "@/lib/progress/policy";

/** Report a segment once this much media time has been played. */
export const PING_EVERY_SECONDS = 10;
/** Shorter stretches aren't worth a request (matches the server's scale). */
export const MIN_SEGMENT_SECONDS = 0.5;
/** Forward seeks this close to the playhead are allowed (timeupdate lag). */
export const SEEK_TOLERANCE_SECONDS = 0.5;
/** Keep at most this many unsent segments while offline. */
export const MAX_QUEUED_SEGMENTS = 10;

export type ProgressSegment = { from: number; to: number; position: number };

function makeSegment(start: number | null, to: number, position: number): ProgressSegment | null {
  if (start === null || !Number.isFinite(start) || !Number.isFinite(to)) return null;
  if (to - start < MIN_SEGMENT_SECONDS) return null;
  // Never claim more than the server accepts in one ping: keep the most
  // recent part (a throttled background tab loses credit, not honesty).
  return { from: Math.max(start, to - MAX_SEGMENT_SECONDS), to, position };
}

/** Tracks the stretch of video currently being played. */
export class SegmentRecorder {
  private start: number | null = null;

  /** True while a stretch is being recorded (i.e. the video is playing). */
  get isOpen(): boolean {
    return this.start !== null;
  }

  /** Playback started (or resumed after a seek) at media time `t`. */
  begin(t: number): void {
    this.start = t;
  }

  /** Playback stopped at `t`. Returns the segment to report, if any. */
  close(t: number, position: number = t): ProgressSegment | null {
    const start = this.start;
    this.start = null;
    return makeSegment(start, t, position);
  }

  /** Report what has played so far but keep recording from `t`. */
  flush(t: number, position: number = t): ProgressSegment | null {
    const seg = makeSegment(this.start, t, position);
    if (seg) this.start = t;
    return seg;
  }

  /** Called on every timeupdate: flushes once PING_EVERY_SECONDS have played. */
  tick(t: number): ProgressSegment | null {
    if (this.start === null || t - this.start < PING_EVERY_SECONDS) return null;
    return this.flush(t);
  }
}

/**
 * May the student seek to `target`? Allowed when tracking is off or the
 * lecture is complete (rewatching), when the target is at/behind the
 * playhead, or when it lies inside a range the SERVER already accepted.
 */
export function canSeek(opts: {
  target: number;
  /** Playhead position before the seek. */
  previousTime: number;
  /** Ranges the server has accepted as watched. */
  intervals: Interval[];
  /** Tracking off (instructor preview) or lecture already completed. */
  unlocked: boolean;
}): boolean {
  if (opts.unlocked) return true;
  if (opts.target <= opts.previousTime + SEEK_TOLERANCE_SECONDS) return true;
  return isWatched(opts.intervals, opts.target);
}

/** Append a segment, keeping only the newest `max`. */
export function enqueueSegment(
  queue: readonly ProgressSegment[],
  seg: ProgressSegment,
  max: number = MAX_QUEUED_SEGMENTS,
): ProgressSegment[] {
  const next = [...queue, seg];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * What to do with a queued segment after the server answered `status`
 * (0 = the request never got a response).
 *   ok    — accepted (or deliberately ignored); remove it
 *   drop  — the server will never accept it (bad input, no access); remove it
 *   retry — transient (network, 429, 5xx); keep it and try again later
 */
export function classifyProgressStatus(status: number): "ok" | "drop" | "retry" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 0 || status === 429 || status >= 500) return "retry";
  return "drop";
}

/** Exponential backoff: 5 s, 10 s, 20 s … capped at 60 s. */
export function nextBackoffMs(consecutiveFailures: number): number {
  const n = Math.max(1, consecutiveFailures);
  return Math.min(60_000, 5_000 * 2 ** (n - 1));
}
