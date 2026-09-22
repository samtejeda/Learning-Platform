import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleKey } from "@/lib/env";
import { LECTURES_BUCKET } from "./paths";

export * from "./paths";

// ─── Storage access model ─────────────────────────────────────────────────────
// The `lectures` bucket is private with no storage policies, so nothing in
// the browser can touch it directly. This module is the ONLY place the
// service-role key is used, and it is used ONLY for Storage: issuing
// short-lived signed URLs (after the caller has verified ownership or
// enrollment), confirming an uploaded object exists, and deleting objects.
// It must never be used to query the database — Drizzle over DATABASE_URL
// is the sole data path, so app-layer authorization can't be bypassed here.

let adminClient: SupabaseClient | undefined;

function storageClient() {
  adminClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient.storage.from(LECTURES_BUCKET);
}

/** How long a signed upload token stays valid (Supabase default is 2h). */
export const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;
/** How long a signed stream URL stays valid. Player refetches when it expires. */
export const STREAM_URL_TTL_SECONDS = 15 * 60;

/**
 * One-time upload authorisation for exactly `path`. The browser uploads with
 * `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)`; the
 * token grants nothing beyond writing that single object once.
 */
export async function createLectureUploadUrl(path: string): Promise<{ token: string }> {
  const { data, error } = await storageClient().createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    console.error("[storage] createSignedUploadUrl failed", error?.message);
    throw new StorageError("upload_url_failed");
  }
  return { token: data.token };
}

export type ObjectInfo = { sizeBytes: number; contentType: string | null };

/** Metadata for an object, or null if it doesn't exist. */
export async function getObjectInfo(path: string): Promise<ObjectInfo | null> {
  const { data, error } = await storageClient().info(path);
  if (error) {
    // storage-js reports a missing object as an error rather than null data.
    const status = (error as { status?: number; statusCode?: string }).status;
    const statusCode = (error as { status?: number; statusCode?: string }).statusCode;
    if (status === 404 || statusCode === "404" || /not.?found/i.test(error.message)) {
      return null;
    }
    console.error("[storage] info failed", error.message);
    throw new StorageError("info_failed");
  }
  if (!data) return null;
  return { sizeBytes: data.size ?? 0, contentType: data.contentType ?? null };
}

/** Short-lived download URL. Supabase Storage honours Range requests, so the
 * browser's <video> element can seek against it. */
export async function createLectureStreamUrl(
  path: string,
  ttlSeconds: number = STREAM_URL_TTL_SECONDS,
): Promise<{ url: string; expiresAt: Date }> {
  const { data, error } = await storageClient().createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    console.error("[storage] createSignedUrl failed", error?.message);
    throw new StorageError("stream_url_failed");
  }
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
}

/** Best-effort delete; missing objects are not an error. */
export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await storageClient().remove(paths);
  if (error) {
    console.error("[storage] remove failed", error.message);
    throw new StorageError("remove_failed");
  }
}

export class StorageError extends Error {
  constructor(public readonly code: string) {
    super(`storage: ${code}`);
    this.name = "StorageError";
  }
}
