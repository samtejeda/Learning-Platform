import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_SECONDS } from "@/lib/progress/policy";
import { SegmentRecorder, type ProgressSegment } from "@/lib/video/segments";
import { POLL_MS, YoutubeTracker, exceedsCreditedSpeed, type ProgressSink } from "./youtube-adapter";
import { YT_STATE } from "./youtube-types";

/** A fake YT.Player plus a fake clock: advancing time moves the position the way real playback would. */
function setup(startAt = 0) {
  const player = { t: startAt, state: YT_STATE.UNSTARTED as number, rate: 1 };
  let clock = 1_000_000;
  const rates: number[] = [];

  // The same wiring useLectureProgress does with the real SegmentRecorder.
  const recorder = new SegmentRecorder();
  const segments: ProgressSegment[] = [];
  const calls: string[] = [];
  const keep = (s: ProgressSegment | null) => {
    if (s) segments.push(s);
  };
  const sink: ProgressSink = {
    onPlay: (t) => {
      calls.push(`play@${t}`);
      recorder.begin(t);
    },
    onPause: (t) => {
      calls.push(`pause@${t}`);
      keep(recorder.close(t));
    },
    onTimeUpdate: (t) => keep(recorder.tick(t)),
    onSeek: (prev, target, playing) => {
      calls.push(`seek ${prev}->${target} playing=${playing}`);
      keep(recorder.close(prev, target));
      if (playing) recorder.begin(target);
    },
  };

  const tracker = new YoutubeTracker(
    { getCurrentTime: () => player.t, getPlayerState: () => player.state, getPlaybackRate: () => player.rate, getDuration: () => 600 },
    sink,
    () => clock,
    (r) => rates.push(r),
  );
  tracker.begin();

  return {
    player,
    tracker,
    segments,
    calls,
    rates,
    recorder,
    /** Let `seconds` of real time pass, polling every POLL_MS; position advances only while playing. */
    run(seconds: number) {
      const steps = Math.round((seconds * 1000) / POLL_MS);
      for (let i = 0; i < steps; i++) {
        clock += POLL_MS;
        if (player.state === YT_STATE.PLAYING) player.t += (POLL_MS / 1000) * player.rate;
        tracker.poll();
      }
    },
    play() {
      player.state = YT_STATE.PLAYING;
      tracker.handleState(YT_STATE.PLAYING);
    },
    setState(state: number) {
      player.state = state;
      tracker.handleState(state);
    },
    /** A seek: the position changes with no event. */
    jump(to: number) {
      player.t = to;
    },
    tick(ms: number) {
      clock += ms;
    },
  };
}

function noSegmentCrosses(segments: ProgressSegment[], from: number, to: number) {
  for (const s of segments) {
    // A segment may touch the edges but must not cover any of the skipped stretch.
    expect(s.to <= from + 1 || s.from >= to - 1, `segment ${s.from}-${s.to} covers the skipped ${from}-${to}`).toBe(true);
  }
}

describe("YoutubeTracker: steady playback", () => {
  it("reports honest segments of at most 20 seconds, contiguous from where playback started", () => {
    const h = setup();
    h.play();
    h.run(65);
    h.setState(YT_STATE.PAUSED);

    expect(h.segments.length).toBeGreaterThanOrEqual(6);
    for (const s of h.segments) {
      expect(s.to - s.from).toBeLessThanOrEqual(MAX_SEGMENT_SECONDS);
      expect(s.from).toBeGreaterThanOrEqual(0);
    }
    // Back to back, from 0 to about where the position ended.
    expect(h.segments[0].from).toBe(0);
    for (let i = 1; i < h.segments.length; i++) expect(h.segments[i].from).toBeCloseTo(h.segments[i - 1].to, 5);
    expect(h.segments.at(-1)!.to).toBeCloseTo(65, 0);
    expect(h.calls.filter((c) => c.startsWith("seek"))).toEqual([]);
  });

  it("starts from a resumed position without counting it as a seek", () => {
    const h = setup(300);
    h.play();
    h.run(25);
    h.setState(YT_STATE.PAUSED);
    expect(h.calls.filter((c) => c.startsWith("seek"))).toEqual([]);
    expect(h.segments[0].from).toBe(300);
  });

  it("claims nothing while paused", () => {
    const h = setup();
    h.play();
    h.run(12);
    h.setState(YT_STATE.PAUSED);
    const before = h.segments.length;
    h.run(60);
    expect(h.segments).toHaveLength(before);
    expect(h.recorder.isOpen).toBe(false);
  });

  it("closes the stretch on ended", () => {
    const h = setup();
    h.play();
    h.run(5);
    h.setState(YT_STATE.ENDED);
    expect(h.recorder.isOpen).toBe(false);
    expect(h.segments.at(-1)!.to).toBeCloseTo(5, 0);
  });

  it("stops claiming while buffering and starts a new stretch when playing resumes", () => {
    const h = setup();
    h.play();
    h.run(6);
    h.setState(YT_STATE.BUFFERING);
    expect(h.recorder.isOpen).toBe(false);
    h.tick(8000); // eight real seconds of stall: the position does not move
    h.run(0.5);
    h.setState(YT_STATE.PLAYING);
    h.run(6);
    h.setState(YT_STATE.PAUSED);
    const total = h.segments.reduce((sum, s) => sum + (s.to - s.from), 0);
    expect(total).toBeCloseTo(12, 0); // 6 s + 6 s: only the time actually played, not the 8 s stall
  });
});

describe("YoutubeTracker: seeks (YouTube gives no event, and seeking is never blocked)", () => {
  it("does not credit a forward skip while playing", () => {
    const h = setup();
    h.play();
    h.run(12);
    h.jump(300);
    h.run(25);
    h.setState(YT_STATE.PAUSED);

    expect(h.calls.some((c) => c.startsWith("seek") && c.endsWith("playing=true"))).toBe(true);
    noSegmentCrosses(h.segments, 13, 299);
    expect(h.segments.some((s) => s.from >= 299)).toBe(true); // playing resumed at the target counts
  });

  it("does not credit a backward seek as new ground", () => {
    const h = setup();
    h.play();
    h.run(30);
    h.jump(5);
    h.run(10);
    h.setState(YT_STATE.PAUSED);
    for (const s of h.segments) expect(s.to - s.from).toBeLessThanOrEqual(MAX_SEGMENT_SECONDS);
    expect(h.calls.some((c) => c.startsWith("seek 3"))).toBe(true);
  });

  it("does not credit a skip when the viewer seeks and pauses before the next poll", () => {
    const h = setup();
    h.play();
    h.run(9);
    h.tick(200);
    h.jump(400); // seek, then immediately pause
    h.setState(YT_STATE.PAUSED);
    noSegmentCrosses(h.segments, 10, 399);
    expect(h.recorder.isOpen).toBe(false);
  });

  it("follows a seek made while paused and records only from where playing starts", () => {
    const h = setup();
    h.play();
    h.run(11);
    h.setState(YT_STATE.PAUSED);
    h.tick(3000);
    h.jump(250);
    h.run(1);
    h.play();
    h.run(15);
    h.setState(YT_STATE.PAUSED);
    noSegmentCrosses(h.segments, 12, 249);
    expect(h.calls.some((c) => c.endsWith("playing=false"))).toBe(true);
  });

  it("treats a seek that arrives with a buffering event the same way", () => {
    const h = setup();
    h.play();
    h.run(10);
    h.jump(200);
    h.setState(YT_STATE.BUFFERING);
    h.setState(YT_STATE.PLAYING);
    h.run(12);
    h.setState(YT_STATE.PAUSED);
    noSegmentCrosses(h.segments, 11, 199);
  });

  it("does not mistake fast playback for a seek", () => {
    const h = setup();
    h.player.rate = 2;
    h.tracker.handleRate(2);
    h.play();
    h.run(30); // 60 seconds of video
    h.setState(YT_STATE.PAUSED);
    expect(h.calls.filter((c) => c.startsWith("seek"))).toEqual([]);
    for (const s of h.segments) expect(s.to - s.from).toBeLessThanOrEqual(MAX_SEGMENT_SECONDS);
    expect(h.segments.at(-1)!.to).toBeCloseTo(60, 0);
  });
});

describe("YoutubeTracker: speed", () => {
  it("reports a rate change from the event", () => {
    const h = setup();
    h.player.rate = 1.75;
    h.tracker.handleRate(1.75);
    expect(h.rates).toEqual([1.75]);
  });

  it("notices a rate change whose event was missed", () => {
    const h = setup();
    h.player.rate = 1.5;
    h.run(1);
    expect(h.rates).toEqual([1.5]);
    h.run(1);
    expect(h.rates).toEqual([1.5]); // not repeated
  });

  it("shows the notice only above about 1.4x", () => {
    for (const r of [0.25, 0.5, 1, 1.25, 1.4]) expect(exceedsCreditedSpeed(r)).toBe(false);
    for (const r of [1.5, 1.75, 2]) expect(exceedsCreditedSpeed(r)).toBe(true);
    expect(exceedsCreditedSpeed(Number.NaN)).toBe(false);
  });
});

describe("YoutubeTracker: bad readings", () => {
  it("ignores a non-numeric position instead of reporting nonsense", () => {
    const h = setup();
    h.play();
    h.run(2);
    h.player.t = Number.NaN;
    h.run(1);
    expect(h.calls.filter((c) => c.startsWith("seek"))).toEqual([]);
  });
});
