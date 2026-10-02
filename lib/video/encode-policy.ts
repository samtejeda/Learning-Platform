// Pure encode-target policy for lecture uploads. Decided 2026-09-24 (Sam):
// 720p H.264 at ~1.5-2 Mbps keeps 36 courses x ~4 lectures well under the
// included storage and, more importantly, bounds per-view egress.
//
// Verdicts: "reject" is a hard stop (the object is removed); "warn" lets the
// upload through with a note. The reject ceiling sits well above the target
// because encoders overshoot on busy scenes; rejecting at the exact target
// would bounce good files.

import type { Mp4Info } from "./mp4-probe";

export const TARGET_BITRATE_BPS = 2_000_000;
/** Above this (but under the ceiling) the upload succeeds with a warning. */
export const WARN_BITRATE_BPS = 2_250_000;
/** Above this the upload is rejected. */
export const REJECT_BITRATE_BPS = 3_000_000;
/** Landscape 1280x720; portrait phone video (720x1280) also passes. */
export const MAX_SHORT_SIDE = 720;
export const MAX_LONG_SIDE = 1280;

const FIX = "Re-export with the preset in docs/ENCODING.md.";

export type EncodeVerdict =
  | { verdict: "ok"; notes: [] }
  | { verdict: "warn"; notes: string[] }
  | { verdict: "reject"; notes: string[] };

const mbps = (bps: number) => (bps / 1_000_000).toFixed(1);

export function evaluateEncode(info: Mp4Info): EncodeVerdict {
  const rejects: string[] = [];
  const warns: string[] = [];

  if (info.videoCodec !== "avc1" && info.videoCodec !== "avc3") {
    rejects.push(`This video isn't H.264 (found ${info.videoCodec ?? "no video track"}). ${FIX}`);
  }
  if (!info.fastStart) {
    rejects.push(`The video's index is at the end of the file, so it can't start playing quickly. ${FIX}`);
  }
  const short = Math.min(info.width, info.height);
  const long = Math.max(info.width, info.height);
  if (short > MAX_SHORT_SIDE || long > MAX_LONG_SIDE) {
    rejects.push(`This video is ${info.width}x${info.height}; the maximum is 1280x720. ${FIX}`);
  }
  if (info.bitrateBps > REJECT_BITRATE_BPS) {
    rejects.push(
      `This video averages ${mbps(info.bitrateBps)} Mbps; the maximum is ${mbps(REJECT_BITRATE_BPS)} Mbps. ${FIX}`,
    );
  } else if (info.bitrateBps > WARN_BITRATE_BPS) {
    warns.push(
      `This video averages ${mbps(info.bitrateBps)} Mbps, above the ${mbps(TARGET_BITRATE_BPS)} Mbps target. It was accepted; a lower bitrate saves bandwidth.`,
    );
  }

  if (rejects.length > 0) return { verdict: "reject", notes: rejects };
  if (warns.length > 0) return { verdict: "warn", notes: warns };
  return { verdict: "ok", notes: [] };
}
