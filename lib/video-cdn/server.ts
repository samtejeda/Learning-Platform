import "server-only";

import { logger } from "@/lib/logger";
import { signVideoCdnUrl } from "./token";

/**
 * Routes a lecture stream through the CDN Worker when it's configured, else
 * returns the Supabase signed URL unchanged. Unsetting VIDEO_CDN_URL is the
 * rollback; previews (which don't have the secret) keep working the same way.
 * Any failure falls back to the direct URL: video should degrade to "uncached",
 * never to "broken".
 *
 * Call only AFTER the caller has verified enrollment/ownership: the Worker
 * authorizes nothing, it trusts that Next minted this URL deliberately.
 */
export async function toCdnUrl(objectPath: string, signed: { url: string; expiresAt: Date }): Promise<string> {
  const baseUrl = process.env.VIDEO_CDN_URL?.trim();
  const secret = process.env.VIDEO_CDN_HMAC_SECRET?.trim();
  if (!baseUrl || !secret) return signed.url;
  try {
    return await signVideoCdnUrl({
      baseUrl,
      objectPath,
      originUrl: signed.url,
      exp: Math.floor(signed.expiresAt.getTime() / 1000),
      secret,
    });
  } catch (err) {
    logger.error("video_cdn.sign_failed", { err });
    return signed.url;
  }
}
