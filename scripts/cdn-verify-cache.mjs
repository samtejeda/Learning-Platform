// Phase 0 CDN check: does Supabase's Storage CDN cache a lecture video, and
// does a DIFFERENT signed token for the SAME object still hit the cache?
//
//   pnpm cdn:verify -- courses/<courseId>/lectures/<lectureId>/video.mp4
//
// With VIDEO_CDN_URL and VIDEO_CDN_HMAC_SECRET also set, it then runs the
// same measurement through the CDN Worker plus its security checks (bad/
// expired/tampered signature, wrong method). Part 2 duplicates the signing in
// lib/video-cdn/token.ts (this script is plain Node); keep the two in sync.
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from .env.local).
// Read-only: signs URLs and fetches the first 1 KiB. Prints cache headers only,
// never the signed URLs or tokens.
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const path = process.argv.slice(2).find((a) => a !== "--");
if (!path) {
  console.error("usage: pnpm cdn:verify -- <object path in the lectures bucket>");
  process.exit(2);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from("lectures");

async function sign(ttl) {
  const { data, error } = await bucket.createSignedUrl(path, ttl);
  if (error || !data) throw new Error(`sign failed: ${error?.message}`);
  return data.signedUrl;
}

async function probe(label, signedUrl) {
  const res = await fetch(signedUrl, { headers: { Range: "bytes=0-1023" } });
  await res.arrayBuffer();
  const h = (n) => res.headers.get(n) ?? "-";
  console.log(
    `${label.padEnd(34)} status=${res.status} cf-cache-status=${h("cf-cache-status")} age=${h("age")} ` +
      `cache-control=${h("cache-control")} content-range=${h("content-range")}`,
  );
  return res.headers.get("cf-cache-status");
}

const a = await sign(900);
await new Promise((r) => setTimeout(r, 1100)); // different iat/exp => different token
const b = await sign(900);
console.log(`tokens differ: ${a !== b}\n`);

const r1 = await probe("URL A, first request", a);
const r2 = await probe("URL A, repeat (same token)", a);
const r3 = await probe("URL B, other token, same object", b);

const hit = (s) => /^HIT$/i.test(s ?? "");
console.log("\nverdict:");
console.log(`  same-URL repeat hits cache:        ${hit(r2)}`);
console.log(`  different token still hits cache:  ${hit(r3)}   <- the one that matters`);
if (!hit(r3)) {
  console.log(
    "  => Supabase's CDN keys on the full URL (or refuses to cache). Options: stable rounded\n" +
      "     signing (only if the token has no per-call field), or a Cloudflare Worker keyed on path.",
  );
}

// ─── Part 2: the CDN Worker ──────────────────────────────────────────────────
const cdnBase = process.env.VIDEO_CDN_URL?.trim().replace(/\/+$/, "");
const cdnSecret = process.env.VIDEO_CDN_HMAC_SECRET?.trim();
if (!cdnBase || !cdnSecret) {
  console.log("\n(VIDEO_CDN_URL / VIDEO_CDN_HMAC_SECRET not set: skipping the Worker checks.)");
  process.exit(0);
}

async function workerUrl({ exp = Math.floor(Date.now() / 1000) + 900, secret = cdnSecret, objectPath = path } = {}) {
  const origin = await sign(900); // a fresh Supabase token every time
  const sig = createHmac("sha256", secret).update(`v1\n${objectPath}\n${exp}\n${origin}`).digest("base64url");
  return `${cdnBase}/v/${objectPath}?${new URLSearchParams({ exp: String(exp), o: origin, sig })}`;
}

async function wprobe(label, u, { range = "bytes=0-1023", method = "GET" } = {}) {
  const res = await fetch(u, { method, headers: range ? { Range: range } : {} });
  const body = Buffer.from(await res.arrayBuffer());
  console.log(
    `${label.padEnd(40)} status=${res.status} x-cache=${res.headers.get("x-cache") ?? "-"} ` +
      `content-range=${res.headers.get("content-range") ?? "-"} bytes=${body.length}`,
  );
  return { res, body };
}

console.log("\nWorker (cache key = object path; every request below carries a different Supabase token):");
const w1 = await wprobe("token 1, first request", await workerUrl());
const w2 = await wprobe("token 2, same object", await workerUrl());
const w3 = await wprobe("token 3, same object", await workerUrl());
const mid = await wprobe("token 4, mid-file range", await workerUrl(), { range: "bytes=100-199" });
console.log("\nsecurity:");
const bad = await wprobe("bad signature", (await workerUrl()).replace(/sig=[^&]+/, "sig=AAAA"));
const exp = await wprobe("expired", await workerUrl({ exp: Math.floor(Date.now() / 1000) - 5 }));
const wrongSecret = await wprobe("signed with the wrong secret", await workerUrl({ secret: "nope" }));
const post = await wprobe("POST", await workerUrl(), { method: "POST" });

const xc = (r) => r.res.headers.get("x-cache");
console.log("\nworker verdict:");
console.log(`  different token hits cache:  ${xc(w2) === "HIT" && xc(w3) === "HIT"}   <- the one that matters`);
console.log(`  first request was a miss:    ${xc(w1) === "MISS" || xc(w1) === "HIT"} (x-cache=${xc(w1)}; HIT if already warm)`);
console.log(`  range slice is 100 bytes:    ${mid.body.length === 100 && mid.res.status === 206}`);
console.log(`  bad/expired/forged -> 403:   ${[bad, exp, wrongSecret].every((r) => r.res.status === 403)}`);
console.log(`  POST -> 405:                 ${post.res.status === 405}`);
