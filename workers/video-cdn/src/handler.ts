// Request handler for the lecture-video CDN Worker. All logic lives here with
// the cache and origin fetch injected, so it is unit-tested without Cloudflare.
// Entry point: ./index.ts. Design and trust model: docs/RUNBOOK.md section 8.

import { CHUNK_BYTES, parseRangeHeader, planResponse, resolveRange, chunkIndexFor } from "../../../lib/video-cdn/chunks";
import { verifyVideoCdnRequest } from "../../../lib/video-cdn/token";

export type Env = { VIDEO_CDN_HMAC_SECRET: string; SUPABASE_ORIGIN: string };
export type CacheLike = {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, res: Response): Promise<void>;
};
export type Deps = {
  cache: CacheLike;
  fetchOrigin: (url: string, init: RequestInit) => Promise<Response>;
  /** Registers background work (cache writes) so it outlives the response. */
  waitUntil: (p: Promise<unknown>) => void;
  nowSeconds: number;
};

const CACHE_VERSION = "c1";

const forbidden = () => new Response("forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });

type Chunk = { body: ArrayBuffer; total: number; hit: boolean };

async function getChunk(
  index: number,
  objectPath: string,
  originUrl: string,
  deps: Deps,
): Promise<Chunk | Response> {
  const key = new Request(`https://video-cdn.internal/${CACHE_VERSION}/${CHUNK_BYTES}/${objectPath}/${index}`);
  const cached = await deps.cache.match(key);
  if (cached) {
    const total = Number(cached.headers.get("x-total"));
    if (Number.isSafeInteger(total) && total > 0) return { body: await cached.arrayBuffer(), total, hit: true };
  }

  const start = index * CHUNK_BYTES;
  let res: Response;
  try {
    res = await deps.fetchOrigin(originUrl, {
      headers: { Range: `bytes=${start}-${start + CHUNK_BYTES - 1}` },
      redirect: "manual",
    });
  } catch {
    return new Response("upstream unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (res.status === 404 || res.status === 400) {
    return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (res.status === 416) {
    return new Response("range not satisfiable", { status: 416, headers: { "Cache-Control": "no-store" } });
  }

  let total: number;
  if (res.status === 206) {
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
    if (!m || Number(m[1]) !== start) return new Response("bad upstream", { status: 502, headers: { "Cache-Control": "no-store" } });
    total = Number(m[3]);
  } else if (res.status === 200 && index === 0) {
    // Origin ignored Range: only acceptable when the whole file fits one chunk.
    const len = Number(res.headers.get("content-length"));
    if (!Number.isSafeInteger(len) || len <= 0 || len > CHUNK_BYTES) {
      return new Response("bad upstream", { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    total = len;
  } else {
    return new Response("bad upstream", { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const body = await res.arrayBuffer();
  const expected = Math.min(start + CHUNK_BYTES, total) - start;
  if (!Number.isSafeInteger(total) || total <= 0 || body.byteLength !== expected) {
    return new Response("bad upstream", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  // Object paths are never rewritten once a lecture is finalized, so the copy
  // is immutable. Reachability is gated by the HMAC, not by this cache.
  deps.waitUntil(
    deps.cache.put(
      key,
      new Response(body, {
        headers: { "Cache-Control": "public, max-age=31536000, immutable", "x-total": String(total) },
      }),
    ),
  );
  return { body, total, hit: false };
}

export async function handleRequest(req: Request, env: Env, deps: Deps): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const verified = await verifyVideoCdnRequest(new URL(req.url), env.VIDEO_CDN_HMAC_SECRET, env.SUPABASE_ORIGIN, deps.nowSeconds);
  if (!verified.ok) return forbidden(); // one generic answer: don't tell a prober which check failed
  const { objectPath, originUrl } = verified;

  const parsed = parseRangeHeader(req.headers.get("range"));
  const spec = parsed === "invalid" ? null : parsed;

  // Learn the file size (and serve the common cases) from the chunk the range starts in.
  const firstIndex = spec && spec.kind === "from" ? chunkIndexFor(spec.start) : 0;
  let chunk = await getChunk(firstIndex, objectPath, originUrl, deps);
  if (chunk instanceof Response) return chunk;
  const total = chunk.total;

  const range = resolveRange(spec, total);
  if (!range) {
    return new Response("range not satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${total}`, "Cache-Control": "no-store" },
    });
  }
  const plan = planResponse(range, total);
  if (plan.chunkIndex !== firstIndex) {
    chunk = await getChunk(plan.chunkIndex, objectPath, originUrl, deps); // suffix ranges
    if (chunk instanceof Response) return chunk;
  }

  const slice =
    plan.offset === 0 && plan.length === chunk.body.byteLength ? chunk.body : chunk.body.slice(plan.offset, plan.offset + plan.length);

  return new Response(req.method === "HEAD" ? null : slice, {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(plan.length),
      "Content-Range": `bytes ${plan.start}-${plan.end}/${total}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=900",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Cache": chunk.hit ? "HIT" : "MISS",
    },
  });
}
