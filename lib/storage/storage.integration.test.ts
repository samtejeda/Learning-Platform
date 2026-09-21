import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  createLectureStreamUrl,
  createLectureUploadUrl,
  getObjectInfo,
  lectureObjectPath,
  LECTURES_BUCKET,
  removeObjects,
} from "@/lib/storage";

// Real Storage round trip (no mocks): the exact sequence the upload form and
// the player use. Needs SUPABASE_SERVICE_ROLE_KEY. Uses a random course id
// and removes what it creates.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const path = lectureObjectPath(randomUUID(), randomUUID(), "video/mp4");
// 64 bytes of placeholder data; Storage checks the declared content type, not
// the codec, so this exercises the same path a real (much larger) file takes.
const body = new Blob([new Uint8Array(64).map((_, i) => i)], { type: "video/mp4" });

describe("Supabase Storage round trip (private lectures bucket)", () => {
  afterAll(async () => {
    await removeObjects([path]).catch(() => {});
  });

  it("reports a missing object as null", async () => {
    expect(await getObjectInfo(path)).toBeNull();
  });

  it("browser-side upload with a server-issued token works, and only for that path", async () => {
    const { token } = await createLectureUploadUrl(path);
    const browser = createClient(url, anonKey, { auth: { persistSession: false } });

    const ok = await browser.storage
      .from(LECTURES_BUCKET)
      .uploadToSignedUrl(path, token, body, { contentType: "video/mp4", upsert: true });
    expect(ok.error).toBeNull();

    // The same token must not authorise a different path.
    const other = lectureObjectPath(randomUUID(), randomUUID(), "video/mp4");
    const bad = await browser.storage
      .from(LECTURES_BUCKET)
      .uploadToSignedUrl(other, token, body, { contentType: "video/mp4" });
    expect(bad.error).not.toBeNull();
    expect(await getObjectInfo(other)).toBeNull();
  });

  it("the server can verify the object and its content type", async () => {
    const info = await getObjectInfo(path);
    expect(info).toMatchObject({ sizeBytes: 64, contentType: "video/mp4" });
  });

  it("a non-allowlisted content type is refused by the bucket itself", async () => {
    const badPath = lectureObjectPath(randomUUID(), randomUUID(), "video/mp4");
    const { token } = await createLectureUploadUrl(badPath);
    const browser = createClient(url, anonKey, { auth: { persistSession: false } });
    const res = await browser.storage
      .from(LECTURES_BUCKET)
      .uploadToSignedUrl(badPath, token, new Blob(["<script>"], { type: "text/html" }), {
        contentType: "text/html",
      });
    expect(res.error).not.toBeNull();
    expect(await getObjectInfo(badPath)).toBeNull();
  });

  it("a signed stream URL serves the bytes and honours Range requests", async () => {
    const { url: signed, expiresAt } = await createLectureStreamUrl(path, 60);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const full = await fetch(signed);
    expect(full.status).toBe(200);
    expect((await full.arrayBuffer()).byteLength).toBe(64);

    const part = await fetch(signed, { headers: { Range: "bytes=10-19" } });
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]));
  });

  it("the bucket is private: no public URL, no anonymous read or list", async () => {
    const pub = await fetch(`${url}/storage/v1/object/public/${LECTURES_BUCKET}/${path}`);
    expect(pub.ok).toBe(false);

    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const dl = await anon.storage.from(LECTURES_BUCKET).download(path);
    expect(dl.error).not.toBeNull();
    const list = await anon.storage.from(LECTURES_BUCKET).list("courses");
    expect(list.data ?? []).toEqual([]);
    const sign = await anon.storage.from(LECTURES_BUCKET).createSignedUrl(path, 60);
    expect(sign.error).not.toBeNull();
  });

  it("delete removes the object", async () => {
    await removeObjects([path]);
    expect(await getObjectInfo(path)).toBeNull();
    await expect(removeObjects([])).resolves.toBeUndefined();
  });
});
