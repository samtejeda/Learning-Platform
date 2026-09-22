import { describe, expect, it } from "vitest";
import { extForMime, isLectureMimeType, lectureObjectPath, LECTURE_MAX_BYTES } from "./paths";

const COURSE = "11111111-1111-4111-8111-111111111111";
const LECTURE = "22222222-2222-4222-8222-222222222222";

describe("lecture storage paths", () => {
  it("builds a deterministic path under the course and lecture ids", () => {
    expect(lectureObjectPath(COURSE, LECTURE, "video/mp4")).toBe(
      `courses/${COURSE}/lectures/${LECTURE}/video.mp4`,
    );
    expect(lectureObjectPath(COURSE, LECTURE, "video/webm")).toMatch(/video\.webm$/);
    expect(lectureObjectPath(COURSE, LECTURE, "video/quicktime")).toMatch(/video\.mov$/);
  });

  it("refuses non-UUID ids so a path can never carry user input", () => {
    expect(() => lectureObjectPath("../etc", LECTURE, "video/mp4")).toThrow();
    expect(() => lectureObjectPath(COURSE, "x/y", "video/mp4")).toThrow();
  });

  it("only accepts the allowlisted container types", () => {
    expect(isLectureMimeType("video/mp4")).toBe(true);
    expect(isLectureMimeType("video/x-matroska")).toBe(false);
    expect(isLectureMimeType("text/html")).toBe(false);
    expect(isLectureMimeType(null)).toBe(false);
    expect(extForMime("video/mp4")).toBe("mp4");
  });

  it("has a sane upload ceiling", () => {
    expect(LECTURE_MAX_BYTES).toBe(2 * 1024 ** 3);
  });
});
