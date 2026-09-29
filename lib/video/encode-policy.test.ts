import { describe, expect, it } from "vitest";
import { evaluateEncode } from "./encode-policy";
import type { Mp4Info } from "./mp4-probe";

const good: Mp4Info = {
  durationSeconds: 2700,
  width: 1280,
  height: 720,
  videoCodec: "avc1",
  fastStart: true,
  bitrateBps: 1_800_000,
};

describe("evaluateEncode", () => {
  it("passes a 720p H.264 fast-start file at the target bitrate", () => {
    expect(evaluateEncode(good)).toEqual({ verdict: "ok", notes: [] });
  });

  it("warns between the warn threshold and the ceiling", () => {
    const r = evaluateEncode({ ...good, bitrateBps: 2_600_000 });
    expect(r.verdict).toBe("warn");
  });

  it("does not bounce a small overshoot of the target", () => {
    expect(evaluateEncode({ ...good, bitrateBps: 2_200_000 }).verdict).toBe("ok");
  });

  it("rejects above the ceiling", () => {
    const r = evaluateEncode({ ...good, bitrateBps: 6_000_000 });
    expect(r.verdict).toBe("reject");
    expect(r.notes[0]).toContain("docs/ENCODING.md");
  });

  it("rejects HEVC and missing video tracks", () => {
    expect(evaluateEncode({ ...good, videoCodec: "hvc1" }).verdict).toBe("reject");
    expect(evaluateEncode({ ...good, videoCodec: null }).verdict).toBe("reject");
  });

  it("rejects files whose index is at the end", () => {
    expect(evaluateEncode({ ...good, fastStart: false }).verdict).toBe("reject");
  });

  it("rejects 1080p but accepts portrait 720x1280", () => {
    expect(evaluateEncode({ ...good, width: 1920, height: 1080 }).verdict).toBe("reject");
    expect(evaluateEncode({ ...good, width: 720, height: 1280 }).verdict).toBe("ok");
  });

  it("reports every problem at once", () => {
    const r = evaluateEncode({ ...good, videoCodec: "hvc1", fastStart: false, bitrateBps: 9_000_000 });
    expect(r.notes).toHaveLength(3);
  });
});
