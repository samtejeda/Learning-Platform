// Pure parser for the YouTube link a professor pastes. It extracts ONLY the
// 11-character video id; the id is the only thing ever stored or sent to a
// browser. Nothing here (or anywhere) fetches the URL: no oEmbed, no thumbnail
// lookup, so a pasted link can never make the server request anything (SSRF).
//
// Deliberately strict. Anything not clearly a single YouTube video is rejected:
// other hosts, look-alike hosts, plain http, credentials/ports in the URL,
// playlist-only links, and bare ids.

export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Exact hosts (URL parsing lowercases and punycodes, so look-alikes never match). */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const SHORT_HOST = "youtu.be";

/** Path forms where the id is the next segment (`/shorts/ID`, ...). */
const ID_PREFIXES = new Set(["shorts", "embed", "live", "v"]);

const MAX_INPUT_LENGTH = 300;

export type YoutubeParseResult =
  | { ok: true; videoId: string }
  | { ok: false; reason: "invalid_link" };

const REJECT: YoutubeParseResult = { ok: false, reason: "invalid_link" };

function validId(candidate: string | null | undefined): string | null {
  if (!candidate || !YOUTUBE_ID_PATTERN.test(candidate)) return null;
  // `/embed/videoseries?list=…` is a playlist embed whose "id" happens to be
  // exactly 11 valid characters.
  if (candidate === "videoseries") return null;
  return candidate;
}

export function parseYoutubeLink(input: unknown): YoutubeParseResult {
  if (typeof input !== "string") return REJECT;
  const raw = input.trim();
  if (raw.length === 0 || raw.length > MAX_INPUT_LENGTH) return REJECT;
  // No whitespace, control characters or backslashes anywhere (parser-differential tricks).
  if (/[\s\u0000-\u001f\u007f\\]/.test(raw)) return REJECT;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return REJECT;
  }

  if (url.protocol !== "https:") return REJECT;
  if (url.username !== "" || url.password !== "" || url.port !== "") return REJECT;

  const host = url.hostname;
  const segments = url.pathname.split("/").filter((s, i, all) => !(s === "" && i === all.length - 1)).slice(1);

  if (host === SHORT_HOST) {
    // youtu.be/ID (a trailing slash is fine; anything deeper is not)
    if (segments.length !== 1) return REJECT;
    const id = validId(segments[0]);
    return id ? { ok: true, videoId: id } : REJECT;
  }

  if (!YOUTUBE_HOSTS.has(host)) return REJECT;

  if (segments.length === 1 && segments[0] === "watch") {
    const values = url.searchParams.getAll("v");
    if (values.length !== 1) return REJECT; // none (playlist-only) or ambiguous
    const id = validId(values[0]);
    return id ? { ok: true, videoId: id } : REJECT;
  }

  if (segments.length === 2 && ID_PREFIXES.has(segments[0])) {
    const id = validId(segments[1]);
    return id ? { ok: true, videoId: id } : REJECT;
  }

  return REJECT;
}
