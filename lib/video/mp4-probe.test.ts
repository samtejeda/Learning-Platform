import { describe, expect, it } from "vitest";
import { probeMp4 } from "./mp4-probe";
import { box, cat, enc, ftyp, moov, mvhd, u32, videoTrak, zeros } from "./mp4-fixture";

describe("probeMp4", () => {
  it("reads duration, resolution, codec and fast-start from a moov-first file", () => {
    const head = cat(ftyp, moov(), box("mdat", zeros(64)));
    const total = 75_000_000; // 600 s => 1 Mbps
    const r = probeMp4(head, total);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info.durationSeconds).toBe(600);
    expect(r.info.width).toBe(1280);
    expect(r.info.height).toBe(720);
    expect(r.info.videoCodec).toBe("avc1");
    expect(r.info.fastStart).toBe(true);
    expect(r.info.bitrateBps).toBe(1_000_000);
  });

  it("reports HEVC codec", () => {
    const r = probeMp4(cat(ftyp, moov("hvc1")), 1000);
    expect(r.ok && r.info.videoCodec).toBe("hvc1");
  });

  it("flags mdat-before-moov as not fast-start when moov is still in the head", () => {
    const r = probeMp4(cat(ftyp, box("mdat", zeros(32)), moov()), 1000);
    expect(r.ok && r.info.fastStart).toBe(false);
  });

  it("says moov_not_in_head when only ftyp + a huge mdat are in the head", () => {
    const mdatHeader = cat(u32(900_000_000), enc("mdat"));
    const r = probeMp4(cat(ftyp, mdatHeader, zeros(1000)), 900_000_100);
    expect(r).toEqual({ ok: false, reason: "moov_not_in_head" });
  });

  it("rejects non-MP4 bytes", () => {
    expect(probeMp4(enc("not a video at all, definitely"), 30)).toEqual({ ok: false, reason: "not_mp4" });
    expect(probeMp4(new Uint8Array(0), 0)).toEqual({ ok: false, reason: "not_mp4" });
  });

  it("rejects zero duration or timescale as malformed", () => {
    const bad = box("moov", mvhd(0, 0), videoTrak("avc1", 1, 1));
    expect(probeMp4(cat(ftyp, bad), 1000)).toEqual({ ok: false, reason: "malformed" });
  });

  it("never throws on truncated or hostile input", () => {
    const good = cat(ftyp, moov(), box("mdat", zeros(64)));
    for (let n = 0; n < good.length; n += 7) {
      expect(() => probeMp4(good.slice(0, n), 1000)).not.toThrow();
    }
    const hostile = cat(ftyp, u32(0xffffffff), enc("moov"), zeros(40));
    expect(() => probeMp4(hostile, 1000)).not.toThrow();
    const selfLoop = cat(ftyp, u32(4), enc("free"));
    expect(() => probeMp4(selfLoop, 1000)).not.toThrow();
  });
});
