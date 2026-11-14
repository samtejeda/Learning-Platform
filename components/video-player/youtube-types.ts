// The slice of the YouTube IFrame Player API this app uses, typed by hand (no
// @types package). Everything else in components/video-player/youtube-* depends
// on these shapes only, so tests can pass a fake player.

/** `YT.PlayerState` values. */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/** What the position tracker reads from a player. */
export type YtPlayerLike = {
  getCurrentTime(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  getDuration(): number;
};

export type YtPlayer = YtPlayerLike & { destroy(): void };

export type YtPlayerOptions = {
  videoId: string;
  /** Privacy-enhanced host. Without it the API frames www.youtube.com, which the CSP blocks. */
  host: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YtPlayer }) => void;
    onStateChange?: (event: { data: number; target: YtPlayer }) => void;
    onPlaybackRateChange?: (event: { data: number; target: YtPlayer }) => void;
    onError?: (event: { data: number; target: YtPlayer }) => void;
  };
};

export type YtNamespace = {
  Player: new (element: HTMLElement, options: YtPlayerOptions) => YtPlayer;
};
