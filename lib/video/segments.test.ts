import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_SECONDS } from "@/lib/progress/policy";
import {
  MAX_QUEUED_SEGMENTS,
  PING_EVERY_SECONDS,
  SegmentRecorder,
  canSeek,
  classifyProgressStatus,
  enqueueSegment,
  nextBackoffMs,
  type ProgressSegment,
} from "./segments";

describe("SegmentRecorder", () => {
  it("reports nothing until playback begins", () => {
    const r = new SegmentRecorder();
    expect(r.isOpen).toBe(false);
    expect(r.close(5)).toBeNull();
    expect(r.tick(50)).toBeNull();
  });

  it("closes a played stretch into a segment with the resume position", () => {
    const r = new SegmentRecorder();
    r.begin(2);
    expect(r.isOpen).toBe(true);
    expect(r.close(9)).toEqual({ from: 2, to: 9, position: 9 });
    expect(r.isOpen).toBe(false);
  });

  it("ignores stretches shorter than the minimum", () => {
    const r = new SegmentRecorder();
    r.begin(4);
    expect(r.close(4.3)).toBeNull();
  });

  it("ignores backwards movement (a seek back, or a stale time)", () => {
    const r = new SegmentRecorder();
    r.begin(30);
    expect(r.close(12)).toBeNull();
  });

  it("tick waits for PING_EVERY_SECONDS, then flushes and keeps recording", () => {
    const r = new SegmentRecorder();
    r.begin(0);
    expect(r.tick(PING_EVERY_SECONDS - 0.1)).toBeNull();
    expect(r.tick(PING_EVERY_SECONDS)).toEqual({ from: 0, to: PING_EVERY_SECONDS, position: PING_EVERY_SECONDS });
    expect(r.isOpen).toBe(true);
    // The next segment starts where the last ended: no gap, no overlap.
    expect(r.tick(PING_EVERY_SECONDS * 2)).toEqual({
      from: PING_EVERY_SECONDS,
      to: PING_EVERY_SECONDS * 2,
      position: PING_EVERY_SECONDS * 2,
    });
  });

  it("clamps an over-long stretch to the server's per-ping maximum, keeping the recent part", () => {
    const r = new SegmentRecorder();
    r.begin(0);
    const seg = r.close(90)!;
    expect(seg.to).toBe(90);
    expect(seg.to - seg.from).toBe(MAX_SEGMENT_SECONDS);
    expect(seg.from).toBe(90 - MAX_SEGMENT_SECONDS);
  });

  it("flush with too little played keeps the open stretch untouched", () => {
    const r = new SegmentRecorder();
    r.begin(10);
    expect(r.flush(10.2)).toBeNull();
    expect(r.close(15)).toEqual({ from: 10, to: 15, position: 15 });
  });

  it("supports the seek pattern: close at the old spot, reopen at the target", () => {
    const r = new SegmentRecorder();
    r.begin(0);
    expect(r.close(6, 40)).toEqual({ from: 0, to: 6, position: 40 });
    r.begin(40);
    expect(r.close(48)).toEqual({ from: 40, to: 48, position: 48 });
  });

  it("rejects non-finite times", () => {
    const r = new SegmentRecorder();
    r.begin(0);
    expect(r.close(NaN)).toBeNull();
  });
});

describe("canSeek", () => {
  const base = { previousTime: 20, intervals: [[0, 20]] as [number, number][], unlocked: false };

  it("allows seeking back", () => {
    expect(canSeek({ ...base, target: 3 })).toBe(true);
  });
  it("allows a tiny forward nudge within the timeupdate tolerance", () => {
    expect(canSeek({ ...base, target: 20.4 })).toBe(true);
  });
  it("rejects a forward jump into unwatched video", () => {
    expect(canSeek({ ...base, target: 45 })).toBe(false);
  });
  it("allows a forward seek into a range the server accepted", () => {
    expect(canSeek({ ...base, previousTime: 5, target: 18 })).toBe(true);
  });
  it("allows any seek once unlocked (completed lecture or instructor preview)", () => {
    expect(canSeek({ ...base, target: 999, unlocked: true })).toBe(true);
  });
  it("rejects a forward seek when nothing has been watched yet", () => {
    expect(canSeek({ target: 30, previousTime: 0, intervals: [], unlocked: false })).toBe(false);
  });
});

describe("enqueueSegment", () => {
  const seg = (n: number): ProgressSegment => ({ from: n, to: n + 10, position: n + 10 });

  it("appends in order", () => {
    expect(enqueueSegment([seg(0)], seg(10))).toEqual([seg(0), seg(10)]);
  });
  it("keeps only the newest segments when the queue is full", () => {
    let q: ProgressSegment[] = [];
    for (let i = 0; i < MAX_QUEUED_SEGMENTS + 3; i++) q = enqueueSegment(q, seg(i * 10));
    expect(q).toHaveLength(MAX_QUEUED_SEGMENTS);
    expect(q[0]).toEqual(seg(30));
    expect(q[q.length - 1]).toEqual(seg((MAX_QUEUED_SEGMENTS + 2) * 10));
  });
  it("does not mutate its input", () => {
    const q = [seg(0)];
    enqueueSegment(q, seg(10));
    expect(q).toHaveLength(1);
  });
});

describe("classifyProgressStatus", () => {
  it("2xx is ok", () => {
    expect(classifyProgressStatus(200)).toBe("ok");
  });
  it("network failure, rate limiting and server errors are retried", () => {
    expect(classifyProgressStatus(0)).toBe("retry");
    expect(classifyProgressStatus(429)).toBe("retry");
    expect(classifyProgressStatus(503)).toBe("retry");
  });
  it("client errors are dropped (the server will never accept them)", () => {
    for (const s of [400, 401, 403, 404, 409]) expect(classifyProgressStatus(s)).toBe("drop");
  });
});

describe("nextBackoffMs", () => {
  it("doubles from 5 s and caps at 60 s", () => {
    expect([1, 2, 3, 4, 5, 9].map(nextBackoffMs)).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
  });
  it("treats 0 as the first failure", () => {
    expect(nextBackoffMs(0)).toBe(5000);
  });
});
