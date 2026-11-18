import type { YtNamespace } from "./youtube-types";

// Loads Google's official IFrame Player API script once per page. It is only
// requested when a YouTube lecture (or the professor's link preview) is shown,
// so a course with only uploaded lectures never contacts Google. The script
// origin is allowed by the CSP in next.config.ts.

export const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api";
/** Privacy-enhanced embed host; passed to YT.Player as `host`. */
export const YOUTUBE_EMBED_HOST = "https://www.youtube-nocookie.com";
export const API_LOAD_TIMEOUT_MS = 15_000;

export class YoutubeApiError extends Error {
  constructor(readonly reason: "blocked" | "timeout") {
    super(reason === "blocked" ? "The YouTube player script could not be loaded." : "The YouTube player script took too long to load.");
    this.name = "YoutubeApiError";
  }
}

/** The bits of the browser this module touches, so tests can fake them. */
export type YoutubeApiEnv = {
  win: { YT?: Partial<YtNamespace>; onYouTubeIframeAPIReady?: (() => void) | undefined };
  doc: {
    createElement(tag: "script"): { src: string; async: boolean; onerror: (() => void) | null; remove(): void };
    head: { appendChild(node: unknown): unknown };
  };
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** A loader with its own cache. A failed load is not cached, so "Try again" re-runs it. */
export function createYoutubeApiLoader(getEnv: () => YoutubeApiEnv, timeoutMs: number = API_LOAD_TIMEOUT_MS) {
  let pending: Promise<YtNamespace> | null = null;

  return function load(): Promise<YtNamespace> {
    const env = getEnv();
    const ready = env.win.YT;
    if (ready && typeof ready.Player === "function") return Promise.resolve(ready as YtNamespace);
    if (pending) return pending;

    const attempt = new Promise<YtNamespace>((resolve, reject) => {
      const script = env.doc.createElement("script");
      const previous = env.win.onYouTubeIframeAPIReady;
      let settled = false;
      const timer = env.setTimeout(() => fail("timeout"), timeoutMs);

      function fail(reason: "blocked" | "timeout") {
        if (settled) return;
        settled = true;
        env.clearTimeout(timer);
        env.win.onYouTubeIframeAPIReady = previous;
        script.remove();
        pending = null;
        reject(new YoutubeApiError(reason));
      }

      env.win.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (settled) return;
        const yt = env.win.YT;
        if (!yt || typeof yt.Player !== "function") return fail("blocked");
        settled = true;
        env.clearTimeout(timer);
        resolve(yt as YtNamespace);
      };
      script.src = YOUTUBE_API_SRC;
      script.async = true;
      script.onerror = () => fail("blocked");
      env.doc.head.appendChild(script);
    });
    pending = attempt;
    return attempt;
  };
}

/** The real browser's loader. */
export const loadYoutubeApi = createYoutubeApiLoader(() => ({
  win: window as unknown as YoutubeApiEnv["win"],
  doc: document as unknown as YoutubeApiEnv["doc"],
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
}));
