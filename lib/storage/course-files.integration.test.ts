import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  courseMaterialObjectPath,
  createCourseFileUploadUrl,
  createCourseFileUrl,
  getCourseFileInfo,
  removeCourseFileObjects,
  syllabusObjectPath,
  COURSE_FILES_BUCKET,
} from "@/lib/storage";

// Real Storage round trip (no mocks) on the `course-files` bucket, mirroring
// storage.integration.test.ts for `lectures`. Needs SUPABASE_SERVICE_ROLE_KEY.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const courseId = randomUUID();
const materialId = randomUUID();
const path = courseMaterialObjectPath(courseId, materialId, "application/pdf");
const body = new Blob([new Uint8Array(64).map((_, i) => i)], { type: "application/pdf" });

describe("Supabase Storage round trip (private course-files bucket)", () => {
  afterAll(async () => {
    await removeCourseFileObjects([path]).catch(() => {});
  });

  it("reports a missing object as null", async () => {
    expect(await getCourseFileInfo(path)).toBeNull();
  });

  it("browser-side upload with a server-issued token works, and only for that path", async () => {
    const { token } = await createCourseFileUploadUrl(path);
    const browser = createClient(url, anonKey, { auth: { persistSession: false } });

    const ok = await browser.storage
      .from(COURSE_FILES_BUCKET)
      .uploadToSignedUrl(path, token, body, { contentType: "application/pdf", upsert: true });
    expect(ok.error).toBeNull();

    // The same token must not authorise a different path.
    const other = courseMaterialObjectPath(courseId, randomUUID(), "application/pdf");
    const bad = await browser.storage
      .from(COURSE_FILES_BUCKET)
      .uploadToSignedUrl(other, token, body, { contentType: "application/pdf" });
    expect(bad.error).not.toBeNull();
    expect(await getCourseFileInfo(other)).toBeNull();
  });

  it("the server can verify the object and its content type", async () => {
    const info = await getCourseFileInfo(path);
    expect(info).toMatchObject({ sizeBytes: 64, contentType: "application/pdf" });
  });

  it("a non-allowlisted content type is refused by the bucket itself", async () => {
    const badPath = syllabusObjectPath(randomUUID());
    const { token } = await createCourseFileUploadUrl(badPath);
    const browser = createClient(url, anonKey, { auth: { persistSession: false } });
    const res = await browser.storage
      .from(COURSE_FILES_BUCKET)
      .uploadToSignedUrl(badPath, token, new Blob(["<script>"], { type: "text/html" }), {
        contentType: "text/html",
      });
    expect(res.error).not.toBeNull();
    expect(await getCourseFileInfo(badPath)).toBeNull();
  });

  it("a signed URL serves the bytes and honours Range requests", async () => {
    const { url: signed, expiresAt } = await createCourseFileUrl(path, 60);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const full = await fetch(signed);
    expect(full.status).toBe(200);
    expect((await full.arrayBuffer()).byteLength).toBe(64);

    const part = await fetch(signed, { headers: { Range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]));
  });

  it("the bucket is private: no public URL, no anonymous read or list", async () => {
    const pub = await fetch(`${url}/storage/v1/object/public/${COURSE_FILES_BUCKET}/${path}`);
    expect(pub.ok).toBe(false);

    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const dl = await anon.storage.from(COURSE_FILES_BUCKET).download(path);
    expect(dl.error).not.toBeNull();
    const list = await anon.storage.from(COURSE_FILES_BUCKET).list("courses");
    expect(list.data ?? []).toEqual([]);
    const sign = await anon.storage.from(COURSE_FILES_BUCKET).createSignedUrl(path, 60);
    expect(sign.error).not.toBeNull();
  });

  it("delete removes the object", async () => {
    await removeCourseFileObjects([path]);
    expect(await getCourseFileInfo(path)).toBeNull();
    await expect(removeCourseFileObjects([])).resolves.toBeUndefined();
  });
});
