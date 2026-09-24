import { describe, expect, it } from "vitest";
import { materialTypeLabel } from "./label";

describe("materialTypeLabel", () => {
  it("labels link kind regardless of mimeType", () => {
    expect(materialTypeLabel("link", null)).toBe("Link");
  });

  it("labels common file kinds", () => {
    expect(materialTypeLabel("file", "application/pdf")).toBe("PDF");
    expect(materialTypeLabel("file", "image/png")).toBe("Image");
    expect(materialTypeLabel("file", "video/mp4")).toBe("Video");
    expect(materialTypeLabel("file", "application/msword")).toBe("Document");
    expect(
      materialTypeLabel("file", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("Document");
    expect(materialTypeLabel("file", "application/vnd.ms-powerpoint")).toBe("Slides");
  });

  it("falls back to a generic File label", () => {
    expect(materialTypeLabel("file", null)).toBe("File");
    expect(materialTypeLabel("file", "application/octet-stream")).toBe("File");
  });
});
