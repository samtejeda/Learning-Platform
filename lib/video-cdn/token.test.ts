import { describe, expect, it } from "vitest";
import { isAllowedOrigin, signVideoCdnUrl, verifyVideoCdnRequest } from "./token";

const SECRET = "test-secret-not-real";
const SB = "https://abc.supabase.co";
const C = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";
const PATH = `courses/${C}/lectures/${L}/video.mp4`;
const ORIGIN = `${SB}/storage/v1/object/sign/lectures/${PATH}?token=abc.def.ghi`;
const NOW = 1_800_000_000;

const mint = (over: Partial<Parameters<typeof signVideoCdnUrl>[0]> = {}) =>
  signVideoCdnUrl({ baseUrl: "https://w.workers.dev", objectPath: PATH, originUrl: ORIGIN, exp: NOW + 900, secret: SECRET, ...over });

describe("video CDN token", () => {
  it("round-trips", async () => {
    const r = await verifyVideoCdnRequest(new URL(await mint()), SECRET, SB, NOW);
    expect(r).toEqual({ ok: true, objectPath: PATH, originUrl: ORIGIN, exp: NOW + 900 });
  });

  it("rejects a wrong secret", async () => {
    const r = await verifyVideoCdnRequest(new URL(await mint()), "other", SB, NOW);
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects expiry and over-long horizons", async () => {
    expect(await verifyVideoCdnRequest(new URL(await mint()), SECRET, SB, NOW + 901)).toEqual({ ok: false, reason: "expired" });
    const far = await mint({ exp: NOW + 7200 });
    expect(await verifyVideoCdnRequest(new URL(far), SECRET, SB, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered path, exp, origin or signature", async () => {
    const url = new URL(await mint());
    const otherPath = `courses/${C}/lectures/33333333-3333-4333-8333-333333333333/video.mp4`;
    const p = new URL(url);
    p.pathname = `/v/${otherPath}`;
    expect((await verifyVideoCdnRequest(p, SECRET, SB, NOW)).ok).toBe(false);

    const e = new URL(url);
    e.searchParams.set("exp", String(NOW + 3000));
    expect((await verifyVideoCdnRequest(e, SECRET, SB, NOW)).ok).toBe(false);

    const o = new URL(url);
    o.searchParams.set("o", ORIGIN + "x");
    expect((await verifyVideoCdnRequest(o, SECRET, SB, NOW)).ok).toBe(false);

    const s = new URL(url);
    s.searchParams.set("sig", "AAAA");
    expect((await verifyVideoCdnRequest(s, SECRET, SB, NOW)).ok).toBe(false);
  });

  it("rejects missing params and non-lecture paths", async () => {
    expect(await verifyVideoCdnRequest(new URL("https://w.workers.dev/v/" + PATH), SECRET, SB, NOW)).toEqual({ ok: false, reason: "bad_params" });
    expect(await verifyVideoCdnRequest(new URL("https://w.workers.dev/"), SECRET, SB, NOW)).toEqual({ ok: false, reason: "bad_path" });
    expect(await verifyVideoCdnRequest(new URL("https://w.workers.dev/v/../etc/passwd"), SECRET, SB, NOW)).toEqual({ ok: false, reason: "bad_path" });
  });

  it("refuses to sign a non-lecture path", async () => {
    await expect(mint({ objectPath: "courses/x/syllabus.pdf" })).rejects.toThrow();
  });

  it("pins the origin to our Supabase host and this exact object", async () => {
    const evil = `https://evil.example/storage/v1/object/sign/lectures/${PATH}?token=a`;
    const signed = new URL(await mint({ originUrl: evil }));
    expect(await verifyVideoCdnRequest(signed, SECRET, SB, NOW)).toEqual({ ok: false, reason: "bad_origin" });

    expect(isAllowedOrigin(ORIGIN, PATH, SB)).toBe(true);
    expect(isAllowedOrigin(ORIGIN.replace("https", "http"), PATH, SB)).toBe(false);
    expect(isAllowedOrigin(`${SB}/storage/v1/object/sign/course-files/${PATH}`, PATH, SB)).toBe(false);
    expect(isAllowedOrigin(`https://user:pw@abc.supabase.co/storage/v1/object/sign/lectures/${PATH}`, PATH, SB)).toBe(false);
    expect(isAllowedOrigin("not a url", PATH, SB)).toBe(false);
  });
});
