import { YT_STATE, type YtPlayerLike } from "./youtube-types";

// Turns a YouTube player's position and state events into the SAME calls the
// uploaded-video player makes on useLectureProgress (onPlay / onPause /
// onTimeUpdate / onSeek), so the segment rules (lib/video/segments.ts) and the
// server's checks are shared, not forked.
//
// YouTube has no seek event and its terms forbid blocking seeks, so a seek is
// found by comparing each position reading with where plain playback would put
// it. A skipped stretch is never claimed: the old segment ends at the last
// position actually seen and a new one starts at the target. No DOM, no React,
// no timers: the caller polls `poll()` and forwards player events.

/** How often the caller should call `poll()`. */
export const POLL_MS = 500;
/** A reading this far from "where playback should be" counts as a seek. */
export const SEEK_JUMP_SECONDS = 1;
/** Above this speed the viewer is told progress may not count in full (the server caps credit at 1.5x). */
export const SPEED_NOTICE_ABOVE = 1.4;

/** Should the "progress counts only up to about 1.5x" notice show at this speed? */
export function exceedsCreditedSpeed(rate: number): boolean {
  return Number.isFinite(rate) && rate > SPEED_NOTICE_ABOVE;
}

/** The calls useLectureProgress already provides. */
export type ProgressSink = {
  onPlay(t: number): void;
  onPause(t: number): void;
  onTimeUpdate(t: number): void;
  onSeek(previousTime: number, target: number, playing: boolean): void;
};

export class YoutubeTracker {
  private lastT: number | null = null;
  private lastAt = 0;
  private playing = false;
  private rate = 1;

  constructor(
    private readonly player: YtPlayerLike,
    private readonly sink: ProgressSink,
    private readonly now: () => number,
    private readonly onRate?: (rate: number) => void,
  ) {}

  /** Read the position once, report a seek if playback jumped, and remember the reading. */
  private sample(): number {
    const t = this.player.getCurrentTime();
    const at = this.now();
    if (!Number.isFinite(t)) return this.lastT ?? 0;
    if (this.lastT !== null) {
      const elapsed = Math.max(0, (at - this.lastAt) / 1000);
      const expected = this.playing ? elapsed * this.rate : 0;
      if (Math.abs(t - (this.lastT + expected)) > SEEK_JUMP_SECONDS) {
        this.sink.onSeek(this.lastT, t, this.playing);
      }
    }
    this.lastT = t;
    this.lastAt = at;
    return t;
  }

  /** Take the starting reading when the player is ready (not a seek). */
  begin(): void {
    this.lastT = null;
    this.sample();
    this.syncRate();
  }

  /** Call every POLL_MS. */
  poll(): void {
    const t = this.sample();
    if (this.playing) this.sink.onTimeUpdate(t);
    this.syncRate();
  }

  /** Forward `onStateChange`. */
  handleState(state: number): void {
    const t = this.sample();
    if (state === YT_STATE.PLAYING) {
      if (!this.playing) {
        this.playing = true;
        this.sink.onPlay(t);
      }
      return;
    }
    // Paused, buffering, ended, cued, unstarted: nothing is being watched.
    if (this.playing) {
      this.playing = false;
      this.sink.onPause(t);
    }
  }

  /** Forward `onPlaybackRateChange`. */
  handleRate(rate: number): void {
    this.sample(); // time up to now was played at the old speed
    this.setRate(rate);
  }

  private syncRate(): void {
    const rate = this.player.getPlaybackRate();
    if (Number.isFinite(rate) && rate > 0 && rate !== this.rate) this.setRate(rate);
  }

  private setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) return;
    this.rate = rate;
    this.onRate?.(rate);
  }
}
