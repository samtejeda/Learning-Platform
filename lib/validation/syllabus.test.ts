import { describe, expect, it } from "vitest";
import { uploadSyllabusSchema } from "./syllabus";

describe("uploadSyllabusSchema", () => {
  it("accepts a PDF within the size cap", () => {
    const r = uploadSyllabusSchema.safeParse({ contentType: "application/pdf", sizeBytes: 1024 });
    expect(r.success).toBe(true);
  });

  it("rejects non-PDF content types and oversized/empty files", () => {
    expect(uploadSyllabusSchema.safeParse({ contentType: "image/png", sizeBytes: 1 }).success).toBe(false);
    expect(uploadSyllabusSchema.safeParse({ contentType: "application/pdf", sizeBytes: 0 }).success).toBe(false);
    expect(
      uploadSyllabusSchema.safeParse({ contentType: "application/pdf", sizeBytes: 3 * 1024 ** 3 }).success,
    ).toBe(false);
    expect(uploadSyllabusSchema.safeParse({ contentType: "application/pdf", sizeBytes: "12" }).success).toBe(
      false,
    );
  });
});
