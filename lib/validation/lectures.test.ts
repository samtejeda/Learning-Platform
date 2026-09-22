import { describe, expect, it } from "vitest";
import { createLectureSchema, finalizeLectureSchema, reorderLecturesSchema } from "./lectures";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("createLectureSchema", () => {
  it("accepts an allowlisted video within the size cap", () => {
    const r = createLectureSchema.safeParse({ title: "Intro", contentType: "video/mp4", sizeBytes: 1024 });
    expect(r.success).toBe(true);
  });
  it("rejects other content types and oversized/empty files", () => {
    expect(createLectureSchema.safeParse({ title: "x", contentType: "text/html", sizeBytes: 1 }).success).toBe(false);
    expect(createLectureSchema.safeParse({ title: "x", contentType: "video/mp4", sizeBytes: 0 }).success).toBe(false);
    expect(createLectureSchema.safeParse({ title: "x", contentType: "video/mp4", sizeBytes: 3 * 1024 ** 3 }).success).toBe(false);
    expect(createLectureSchema.safeParse({ title: "x", contentType: "video/mp4", sizeBytes: "12" }).success).toBe(false);
  });
});

describe("finalizeLectureSchema", () => {
  it("bounds duration to a plausible range", () => {
    expect(finalizeLectureSchema.safeParse({ durationSeconds: 61.5 }).success).toBe(true);
    expect(finalizeLectureSchema.safeParse({ durationSeconds: 0.2 }).success).toBe(false);
    expect(finalizeLectureSchema.safeParse({ durationSeconds: Infinity }).success).toBe(false);
    expect(finalizeLectureSchema.safeParse({ durationSeconds: 90_000 }).success).toBe(false);
  });
});

describe("reorderLecturesSchema", () => {
  it("requires unique uuids", () => {
    expect(reorderLecturesSchema.safeParse({ orderedIds: [U1, U2] }).success).toBe(true);
    expect(reorderLecturesSchema.safeParse({ orderedIds: [U1, U1] }).success).toBe(false);
    expect(reorderLecturesSchema.safeParse({ orderedIds: ["nope"] }).success).toBe(false);
    expect(reorderLecturesSchema.safeParse({ orderedIds: [] }).success).toBe(false);
  });
});
