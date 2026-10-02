// Pure Range -> chunk math for the video CDN Worker. Cloudflare's cache can't
// store partial (206) responses and caps one object at 512 MB (a long lecture
// can exceed that), so the Worker caches fixed-size aligned chunks and answers
// each browser Range request from at most ONE chunk. Browsers happily follow a
// short 206 with another Range request.

export const CHUNK_BYTES = 8 * 1024 * 1024;

export type RangeSpec = { kind: "from"; start: number; end: number | null } | { kind: "suffix"; length: number };

/** Parses a single `bytes=` range. null = absent/unsupported (serve the first chunk as a full-file 206). */
export function parseRangeHeader(header: string | null): RangeSpec | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid"; // multi-range or garbage
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  if (a === "") {
    const length = Number(b);
    return length > 0 ? { kind: "suffix", length } : "invalid";
  }
  const start = Number(a);
  const end = b === "" ? null : Number(b);
  if (!Number.isSafeInteger(start) || (end !== null && (!Number.isSafeInteger(end) || end < start))) return "invalid";
  return { kind: "from", start, end };
}

/** Resolves a spec against the real size. null = unsatisfiable (416). */
export function resolveRange(spec: RangeSpec | null, total: number): { start: number; end: number } | null {
  if (total <= 0) return null;
  if (spec === null) return { start: 0, end: total - 1 };
  if (spec.kind === "suffix") {
    return { start: Math.max(0, total - spec.length), end: total - 1 };
  }
  if (spec.start >= total) return null;
  return { start: spec.start, end: Math.min(spec.end ?? total - 1, total - 1) };
}

export function chunkIndexFor(offset: number): number {
  return Math.floor(offset / CHUNK_BYTES);
}

/** Inclusive byte bounds of chunk `index` in a file of `total` bytes. */
export function chunkBounds(index: number, total: number): { start: number; end: number } {
  const start = index * CHUNK_BYTES;
  return { start, end: Math.min(start + CHUNK_BYTES, total) - 1 };
}

/**
 * What to send for a resolved range: clamp to the chunk the range STARTS in,
 * and say where in that chunk's body to slice.
 */
export function planResponse(range: { start: number; end: number }, total: number) {
  const index = chunkIndexFor(range.start);
  const bounds = chunkBounds(index, total);
  const end = Math.min(range.end, bounds.end);
  return {
    chunkIndex: index,
    chunkStart: bounds.start,
    chunkEnd: bounds.end,
    start: range.start,
    end,
    /** Slice of the chunk body: [offset, offset + length). */
    offset: range.start - bounds.start,
    length: end - range.start + 1,
  };
}
