import { describe, expect, it } from "vitest";
import { YOUTUBE_API_SRC, YoutubeApiError, createYoutubeApiLoader, type YoutubeApiEnv } from "./youtube-api";

function fakeEnv() {
  const scripts: { src: string; async: boolean; onerror: (() => void) | null; removed: boolean; remove(): void }[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const env: YoutubeApiEnv = {
    win: {},
    doc: {
      createElement: () => {
        const s = {
          src: "",
          async: false,
          onerror: null as (() => void) | null,
          removed: false,
          remove() {
            s.removed = true;
          },
        };
        scripts.push(s);
        return s;
      },
      head: { appendChild: () => undefined },
    },
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
  };
  class FakePlayer {}
  return { env, scripts, timers, FakePlayer, becomeReady: () => ((env.win.YT = { Player: FakePlayer as never }), env.win.onYouTubeIframeAPIReady?.()) };
}

describe("YouTube IFrame API loader", () => {
  it("adds the official script once, however many callers ask", async () => {
    const f = fakeEnv();
    const load = createYoutubeApiLoader(() => f.env);
    const a = load();
    const b = load();
    expect(f.scripts).toHaveLength(1);
    expect(f.scripts[0].src).toBe(YOUTUBE_API_SRC);
    f.becomeReady();
    const [ya, yb] = await Promise.all([a, b]);
    expect(ya).toBe(yb);
    expect(typeof ya.Player).toBe("function");
  });

  it("resolves without a script when the API is already on the page", async () => {
    const f = fakeEnv();
    f.env.win.YT = { Player: f.FakePlayer as never };
    const yt = await createYoutubeApiLoader(() => f.env)();
    expect(yt.Player).toBe(f.FakePlayer);
    expect(f.scripts).toHaveLength(0);
  });

  it("keeps a callback someone else already registered working", async () => {
    const f = fakeEnv();
    let other = 0;
    f.env.win.onYouTubeIframeAPIReady = () => {
      other++;
    };
    const p = createYoutubeApiLoader(() => f.env)();
    f.becomeReady();
    await p;
    expect(other).toBe(1);
  });

  it("rejects as blocked when the script cannot load (ad blocker, offline), and a retry starts clean", async () => {
    const f = fakeEnv();
    const load = createYoutubeApiLoader(() => f.env);
    const first = load();
    f.scripts[0].onerror?.();
    await expect(first).rejects.toMatchObject({ name: "YoutubeApiError", reason: "blocked" });
    expect(f.scripts[0].removed).toBe(true);
    expect(f.timers[0].cleared).toBe(true);

    const second = load();
    expect(f.scripts).toHaveLength(2);
    f.becomeReady();
    await expect(second).resolves.toBeTruthy();
  });

  it("rejects with a timeout if the script loads but the API never reports ready", async () => {
    const f = fakeEnv();
    const load = createYoutubeApiLoader(() => f.env, 5000);
    const p = load();
    expect(f.timers[0].ms).toBe(5000);
    f.timers[0].fn();
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YoutubeApiError);
    expect((err as YoutubeApiError).reason).toBe("timeout");
  });

  it("treats a ready callback with no Player as a failure", async () => {
    const f = fakeEnv();
    const p = createYoutubeApiLoader(() => f.env)();
    f.env.win.YT = {};
    f.env.win.onYouTubeIframeAPIReady?.();
    await expect(p).rejects.toMatchObject({ reason: "blocked" });
  });
});
