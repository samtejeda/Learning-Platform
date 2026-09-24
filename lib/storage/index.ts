import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleKey } from "@/lib/env";
import { logger } from "@/lib/logger";
import { COURSE_FILES_BUCKET, LECTURES_BUCKET } from "./paths";

export * from "./paths";

// ─── Storage access model ─────────────────────────────────────────────────────
// Both private buckets (`lectures`, `course-files`) have no storage
// policies, so nothing in the browser can touch them directly. This module
// is the ONLY place the service-role key is used, and it is used ONLY for
// Storage: issuing short-lived signed URLs (after the caller has verified
// ownership or enrollment), confirming an uploaded object exists, and
// deleting objects. It must never be used to query the database — Drizzle
// over DATABASE_URL is the sole data path, so app-layer authorization can't
// be bypassed here.

let adminClient: SupabaseClient | undefined;

function bucket(name: string) {
  adminClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient.storage.from(name);
}

/** How long a signed upload token stays valid (Supabase default is 2h). */
export const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;
/** How long a signed video stream URL stays valid. Player refetches when it expires. */
export const STREAM_URL_TTL_SECONDS = 15 * 60;
/** Signed URLs for documents/course files — longer-lived than video since
 * there's no continuous playback driving refetches. */
export const COURSE_FILE_URL_TTL_SECONDS = 30 * 60;

async function createUploadUrl(bucketName: string, path: string): Promise<{ token: string }> {
  const { data, error } = await bucket(bucketName).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    logger.error("storage.create_signed_upload_url_failed", { bucket: bucketName, err: error });
    throw new StorageError("upload_url_failed");
  }
  return { token: data.token };
}

export type ObjectInfo = { sizeBytes: number; contentType: string | null };

async function objectInfo(bucketName: string, path: string): Promise<ObjectInfo | null> {
  const { data, error } = await bucket(bucketName).info(path);
  if (error) {
    // storage-js reports a missing object as an error rather than null data.
    const status = (error as { status?: number; statusCode?: string }).status;
    const statusCode = (error as { status?: number; statusCode?: string }).statusCode;
    if (status === 404 || statusCode === "404" || /not.?found/i.test(error.message)) {
      return null;
    }
    logger.error("storage.info_failed", { bucket: bucketName, err: error });
    throw new StorageError("info_failed");
  }
  if (!data) return null;
  return { sizeBytes: data.size ?? 0, contentType: data.contentType ?? null };
}

async function signedUrl(
  bucketName: string,
  path: string,
  ttlSeconds: number,
): Promise<{ url: string; expiresAt: Date }> {
  const { data, error } = await bucket(bucketName).createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    logger.error("storage.create_signed_url_failed", { bucket: bucketName, err: error });
    throw new StorageError("stream_url_failed");
  }
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
}

async function removeFromBucket(bucketName: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await bucket(bucketName).remove(paths);
  if (error) {
    logger.error("storage.remove_failed", { bucket: bucketName, err: error });
    throw new StorageError("remove_failed");
  }
}

// ─── Lecture videos (`lectures` bucket) ────────────────────────────────────────

/**
 * One-time upload authorisation for exactly `path`. The browser uploads with
 * `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)`; the
 * token grants nothing beyond writing that single object once.
 */
export async function createLectureUploadUrl(path: string): Promise<{ token: string }> {
  return createUploadUrl(LECTURES_BUCKET, path);
}

/** Metadata for an object, or null if it doesn't exist. */
export async function getObjectInfo(path: string): Promise<ObjectInfo | null> {
  return objectInfo(LECTURES_BUCKET, path);
}

/** Short-lived download URL. Supabase Storage honours Range requests, so the
 * browser's <video> element can seek against it. */
export async function createLectureStreamUrl(
  path: string,
  ttlSeconds: number = STREAM_URL_TTL_SECONDS,
): Promise<{ url: string; expiresAt: Date }> {
  return signedUrl(LECTURES_BUCKET, path, ttlSeconds);
}

/** Best-effort delete; missing objects are not an error. */
export async function removeObjects(paths: string[]): Promise<void> {
  return removeFromBucket(LECTURES_BUCKET, paths);
}

// ─── Course files: syllabus + course materials (`course-files` bucket) ────────

/** One-time upload authorisation for exactly `path`, same shape as the
 * lecture equivalent. Used for both syllabus PDFs and material files. */
export async function createCourseFileUploadUrl(path: string): Promise<{ token: string }> {
  return createUploadUrl(COURSE_FILES_BUCKET, path);
}

/** Metadata for a course-file object, or null if it doesn't exist. */
export async function getCourseFileInfo(path: string): Promise<ObjectInfo | null> {
  return objectInfo(COURSE_FILES_BUCKET, path);
}

/** Short-lived download URL for a syllabus or material file. */
export async function createCourseFileUrl(
  path: string,
  ttlSeconds: number = COURSE_FILE_URL_TTL_SECONDS,
): Promise<{ url: string; expiresAt: Date }> {
  return signedUrl(COURSE_FILES_BUCKET, path, ttlSeconds);
}

/** Best-effort delete; missing objects are not an error. */
export async function removeCourseFileObjects(paths: string[]): Promise<void> {
  return removeFromBucket(COURSE_FILES_BUCKET, paths);
}

export class StorageError extends Error {
  constructor(public readonly code: string) {
    super(`storage: ${code}`);
    this.name = "StorageError";
  }
}
