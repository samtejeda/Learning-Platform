// Phase 0 CDN check: does Supabase's Storage CDN cache a lecture video, and
// does a DIFFERENT signed token for the SAME object still hit the cache?
//
//   pnpm cdn:verify -- courses/<courseId>/lectures/<lectureId>/video.mp4
//
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from .env.local).
// Read-only: signs URLs and fetches the first 1 KiB. Prints cache headers only,
// never the signed URLs or tokens.
import { createClient } from "@supabase/supabase-js";

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
