// Signed URLs for the video CDN Worker. Pure Web Crypto, no Node or Next
// imports, so the SAME code signs in Next (Node) and verifies in the Worker.
//
// URL shape:  <base>/v/<objectPath>?exp=<unix s>&o=<origin signed URL>&sig=<b64url>
// sig = HMAC-SHA256(secret, "v1\n<objectPath>\n<exp>\n<origin URL>")
//
// The Worker is NOT an authorization system: Next decides who may watch
// (auth + enrollment + published) before minting a URL. The HMAC only proves
// "Next minted this, for this object, until exp", so the Worker can't be used
// as an open proxy and a valid URL can't be repointed at another object.

const VERSION = "v1";
/** A minted URL may not claim to live longer than this. */
export const MAX_TTL_SECONDS = 60 * 60;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** The only object paths the Worker will ever serve (see lib/storage/paths.ts). */
const OBJECT_PATH_RE = new RegExp(`^courses/${UUID}/lectures/${UUID}/video\\.mp4$`, "i");

export function isLectureObjectPath(path: string): boolean {
  return OBJECT_PATH_RE.test(path);
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function message(objectPath: string, exp: number, originUrl: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${VERSION}\n${objectPath}\n${exp}\n${originUrl}`);
}

function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signVideoCdnUrl(opts: {
  /** Worker origin, no trailing slash, e.g. https://x.workers.dev */
  baseUrl: string;
  objectPath: string;
  /** The Supabase signed URL the Worker fetches on a cache miss. */
  originUrl: string;
  /** Unix seconds. */
  exp: number;
  secret: string;
}): Promise<string> {
  if (!isLectureObjectPath(opts.objectPath)) throw new Error("signVideoCdnUrl: not a lecture object path");
  const key = await hmacKey(opts.secret, "sign");
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, message(opts.objectPath, opts.exp, opts.originUrl)));
  const q = new URLSearchParams({ exp: String(opts.exp), o: opts.originUrl, sig: b64url(sig) });
  return `${opts.baseUrl.replace(/\/+$/, "")}/v/${opts.objectPath}?${q.toString()}`;
}

export type VerifyResult =
  | { ok: true; objectPath: string; originUrl: string; exp: number }
  | { ok: false; reason: "bad_path" | "bad_params" | "expired" | "bad_signature" | "bad_origin" };

/**
 * Verifies a Worker request URL. `supabaseOrigin` (e.g. https://abc.supabase.co)
 * pins where a cache miss may be fetched from, even for a validly signed URL.
 */
export async function verifyVideoCdnRequest(
  url: URL,
  secret: string,
  supabaseOrigin: string,
  nowSeconds: number,
): Promise<VerifyResult> {
  if (!url.pathname.startsWith("/v/")) return { ok: false, reason: "bad_path" };
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(url.pathname.slice(3));
  } catch {
    return { ok: false, reason: "bad_path" };
  }
  if (!isLectureObjectPath(objectPath)) return { ok: false, reason: "bad_path" };

  const expRaw = url.searchParams.get("exp");
  const originUrl = url.searchParams.get("o");
  const sigRaw = url.searchParams.get("sig");
  if (!expRaw || !/^\d{1,12}$/.test(expRaw) || !originUrl || !sigRaw) return { ok: false, reason: "bad_params" };
  const exp = Number(expRaw);
  const sig = fromB64url(sigRaw);
  if (!sig) return { ok: false, reason: "bad_params" };

  // Signature first (constant-time), so nothing below leaks to unsigned callers.
  const key = await hmacKey(secret, "verify");
  const valid = await crypto.subtle.verify("HMAC", key, sig, message(objectPath, exp, originUrl));
  if (!valid) return { ok: false, reason: "bad_signature" };

  if (exp <= nowSeconds || exp > nowSeconds + MAX_TTL_SECONDS) return { ok: false, reason: "expired" };
  if (!isAllowedOrigin(originUrl, objectPath, supabaseOrigin)) return { ok: false, reason: "bad_origin" };
  return { ok: true, objectPath, originUrl, exp };
}

/** The origin URL must be our own Supabase host and sign THIS exact object. */
export function isAllowedOrigin(originUrl: string, objectPath: string, supabaseOrigin: string): boolean {
  let u: URL;
  try {
    u = new URL(originUrl);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    u.origin === supabaseOrigin &&
    u.username === "" &&
    u.password === "" &&
    u.pathname === `/storage/v1/object/sign/lectures/${objectPath}`
  );
}
