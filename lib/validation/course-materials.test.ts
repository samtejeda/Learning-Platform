import { describe, expect, it } from "vitest";
import { createMaterialSchema, reorderMaterialsSchema } from "./course-materials";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("createMaterialSchema (file kind)", () => {
  it("accepts an allowlisted file within the size cap", () => {
    const r = createMaterialSchema.safeParse({
      kind: "file",
      title: "Handout 1",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(r.success).toBe(true);
  });

  it("rejects other content types and oversized/empty files", () => {
    expect(
      createMaterialSchema.safeParse({ kind: "file", title: "x", contentType: "text/html", sizeBytes: 1 })
        .success,
    ).toBe(false);
    expect(
      createMaterialSchema.safeParse({
        kind: "file",
        title: "x",
        contentType: "application/pdf",
        sizeBytes: 0,
      }).success,
    ).toBe(false);
    expect(
      createMaterialSchema.safeParse({
        kind: "file",
        title: "x",
        contentType: "application/pdf",
        sizeBytes: 3 * 1024 ** 3,
      }).success,
    ).toBe(false);
  });
});

describe("createMaterialSchema (link kind)", () => {
  it("accepts an http(s) URL", () => {
    expect(
      createMaterialSchema.safeParse({ kind: "link", title: "Reading", url: "https://example.com/x" }).success,
    ).toBe(true);
    expect(
      createMaterialSchema.safeParse({ kind: "link", title: "Reading", url: "http://example.com" }).success,
    ).toBe(true);
  });

  it("rejects non-http(s) protocols and malformed URLs", () => {
    expect(
      createMaterialSchema.safeParse({ kind: "link", title: "x", url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(createMaterialSchema.safeParse({ kind: "link", title: "x", url: "ftp://example.com" }).success).toBe(
      false,
    );
    expect(createMaterialSchema.safeParse({ kind: "link", title: "x", url: "not a url" }).success).toBe(false);
  });

  it("requires a title even for link-kind materials", () => {
    expect(createMaterialSchema.safeParse({ kind: "link", title: "", url: "https://example.com" }).success).toBe(
      false,
    );
  });
});

describe("createMaterialSchema discriminated union", () => {
  it("rejects an unknown kind", () => {
    expect(createMaterialSchema.safeParse({ kind: "video", title: "x" }).success).toBe(false);
  });

  it("rejects file fields on a link submission and vice versa", () => {
    expect(
      createMaterialSchema.safeParse({ kind: "link", title: "x", contentType: "application/pdf", sizeBytes: 1 })
        .success,
    ).toBe(false);
    expect(
      createMaterialSchema.safeParse({ kind: "file", title: "x", url: "https://example.com" }).success,
    ).toBe(false);
  });
});

describe("reorderMaterialsSchema", () => {
  it("requires unique uuids", () => {
    expect(reorderMaterialsSchema.safeParse({ orderedIds: [U1, U2] }).success).toBe(true);
    expect(reorderMaterialsSchema.safeParse({ orderedIds: [U1, U1] }).success).toBe(false);
    expect(reorderMaterialsSchema.safeParse({ orderedIds: ["nope"] }).success).toBe(false);
    expect(reorderMaterialsSchema.safeParse({ orderedIds: [] }).success).toBe(false);
  });
});
