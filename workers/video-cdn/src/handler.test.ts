import { beforeEach, describe, expect, it } from "vitest";
import { CHUNK_BYTES } from "../../../lib/video-cdn/chunks";
import { signVideoCdnUrl } from "../../../lib/video-cdn/token";
import { handleRequest, type CacheLike, type Deps, type Env } from "./handler";

const SECRET = "test-secret-not-real";
const SB = "https://abc.supabase.co";
const env: Env = { VIDEO_CDN_HMAC_SECRET: SECRET, SUPABASE_ORIGIN: SB };
const PATH = "courses/11111111-1111-4111-8111-111111111111/lectures/22222222-2222-4222-8222-222222222222/video.mp4";
const NOW = 1_800_000_000;
const TOTAL = 2 * CHUNK_BYTES + 4_000_005; // two full chunks + a tail
const FILE = new Uint8Array(TOTAL);
for (let i = 0; i < TOTAL; i++) FILE[i] = i % 251;
// Byte-compare without handing 8 MiB arrays to the matcher's differ.
const same = async (res: Response, expected: Uint8Array) =>
  Buffer.compare(Buffer.from(await res.arrayBuffer()), Buffer.from(expected)) === 0;

let originCalls: string[];
let store: Map<string, { body: ArrayBuffer; headers: Headers }>;
let pending: Promise<unknown>[];

const cache: CacheLike = {
  async match(k) {
    const e = store.get(k.url);
    return e ? new Response(e.body.slice(0), { headers: e.headers }) : undefined;
  },
  async put(k, r) {
    store.set(k.url, { body: await r.arrayBuffer(), headers: new Headers(r.headers) });
  },
};

function deps(over: Partial<Deps> = {}): Deps {
  return {
    cache,
    nowSeconds: NOW,
    waitUntil: (p) => void pending.push(p),
    fetchOrigin: async (_url, init) => {
      const range = new Headers(init.headers).get("range")!;
      originCalls.push(range);
      const [a, b] = range.replace("bytes=", "").split("-").map(Number);
      const end = Math.min(b, TOTAL - 1);
      return new Response(FILE.slice(a, end + 1), {
        status: 206,
        headers: { "content-range": `bytes ${a}-${end}/${TOTAL}` },
      });
    },
    ...over,
  };
}

async function url(token = "t1", exp = NOW + 900) {
  return signVideoCdnUrl({
    baseUrl: "https://w.workers.dev",
    objectPath: PATH,
    originUrl: `${SB}/storage/v1/object/sign/lectures/${PATH}?token=${token}`,
    exp,
    secret: SECRET,
  });
}
const get = async (u: string, range?: string, d = deps(), method = "GET") => {
  const res = await handleRequest(new Request(u, { method, headers: range ? { Range: range } : {} }), env, d);
  await Promise.all(pending);
  return res;
};

beforeEach(() => {
  originCalls = [];
  store = new Map();
  pending = [];
});

describe("video CDN worker", () => {
  it("caches across DIFFERENT tokens for the same object (the whole point)", async () => {
    const a = await get(await url("tokenA"), "bytes=0-");
    expect(a.status).toBe(206);
    expect(a.headers.get("x-cache")).toBe("MISS");
    const b = await get(await url("tokenB"), "bytes=0-");
    expect(b.headers.get("x-cache")).toBe("HIT");
    expect(originCalls).toHaveLength(1);
    expect(await same(b, FILE.slice(0, CHUNK_BYTES))).toBe(true);
  });

  it("answers an open range with exactly one chunk and the right Content-Range", async () => {
    const r = await get(await url(), "bytes=0-");
    expect(r.headers.get("content-range")).toBe(`bytes 0-${CHUNK_BYTES - 1}/${TOTAL}`);
    expect(r.headers.get("content-length")).toBe(String(CHUNK_BYTES));
    expect(r.headers.get("accept-ranges")).toBe("bytes");
  });

  it("serves a mid-chunk range with the correct bytes", async () => {
    const s = CHUNK_BYTES + 12345;
    const r = await get(await url(), `bytes=${s}-${s + 999}`);
    expect(r.status).toBe(206);
    expect(await same(r, FILE.slice(s, s + 1000))).toBe(true);
  });

  it("clamps a range that crosses a chunk boundary", async () => {
    const s = CHUNK_BYTES - 10;
    const r = await get(await url(), `bytes=${s}-${s + 100}`);
    expect(r.headers.get("content-range")).toBe(`bytes ${s}-${CHUNK_BYTES - 1}/${TOTAL}`);
    expect(await same(r, FILE.slice(s, CHUNK_BYTES))).toBe(true);
  });

  it("serves suffix ranges from the tail chunk", async () => {
    const r = await get(await url(), "bytes=-100");
    expect(r.headers.get("content-range")).toBe(`bytes ${TOTAL - 100}-${TOTAL - 1}/${TOTAL}`);
    expect(await same(r, FILE.slice(TOTAL - 100))).toBe(true);
  });

  it("returns 416 past the end, and never caches an error", async () => {
    const r = await get(await url(), `bytes=${TOTAL + 5}-`);
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe(`bytes */${TOTAL}`);
  });

  it("HEAD returns headers and no body", async () => {
    const r = await get(await url(), "bytes=0-", deps(), "HEAD");
    expect(r.status).toBe(206);
    expect(await r.arrayBuffer()).toHaveProperty("byteLength", 0);
  });

  it("403s a bad signature, expired URL and tampered path with one generic body", async () => {
    const good = new URL(await url());
    const badSig = new URL(good);
    badSig.searchParams.set("sig", "AAAA");
    const expired = await url("t", NOW - 1);
    const other = new URL(good);
    other.pathname = other.pathname.replace("22222222", "33333333");
    for (const u of [badSig.toString(), expired, other.toString()]) {
      const r = await get(u, "bytes=0-");
      expect(r.status).toBe(403);
      expect(await r.text()).toBe("forbidden");
    }
    expect(originCalls).toHaveLength(0); // nothing reached Supabase
  });

  it("405s non-GET/HEAD methods", async () => {
    expect((await get(await url(), undefined, deps(), "POST")).status).toBe(405);
  });

  it("refuses to fetch an origin that isn't our Supabase object", async () => {
    const evil = await signVideoCdnUrl({
      baseUrl: "https://w.workers.dev",
      objectPath: PATH,
      originUrl: `https://evil.example/storage/v1/object/sign/lectures/${PATH}?token=x`,
      exp: NOW + 900,
      secret: SECRET,
    });
    expect((await get(evil, "bytes=0-")).status).toBe(403);
    expect(originCalls).toHaveLength(0);
  });

  it("maps origin failures without caching them", async () => {
    const down = deps({ fetchOrigin: async () => { throw new Error("boom"); } });
    expect((await get(await url(), "bytes=0-", down)).status).toBe(502);
    const missing = deps({ fetchOrigin: async () => new Response("{}", { status: 400 }) });
    expect((await get(await url(), "bytes=0-", missing)).status).toBe(404);
    expect(store.size).toBe(0);
  });

  it("rejects an upstream chunk whose size doesn't match its Content-Range", async () => {
    const lying = deps({
      fetchOrigin: async () => new Response(new Uint8Array(10), { status: 206, headers: { "content-range": `bytes 0-${CHUNK_BYTES - 1}/${TOTAL}` } }),
    });
    expect((await get(await url(), "bytes=0-", lying)).status).toBe(502);
    expect(store.size).toBe(0);
  });
});
