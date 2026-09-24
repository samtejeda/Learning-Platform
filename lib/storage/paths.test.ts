import { describe, expect, it } from "vitest";
import {
  courseMaterialObjectPath,
  extForCourseFileMime,
  extForMime,
  isCourseFileMimeType,
  isLectureMimeType,
  isSyllabusMimeType,
  lectureObjectPath,
  syllabusObjectPath,
  COURSE_FILE_MAX_BYTES,
  LECTURE_MAX_BYTES,
} from "./paths";

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

describe("course file storage paths", () => {
  it("builds a deterministic, fixed syllabus path per course", () => {
    expect(syllabusObjectPath(COURSE)).toBe(`courses/${COURSE}/syllabus.pdf`);
  });

  it("refuses a non-UUID course id for the syllabus path", () => {
    expect(() => syllabusObjectPath("../etc")).toThrow();
  });

  it("builds a deterministic path under the course and material ids", () => {
    expect(courseMaterialObjectPath(COURSE, LECTURE, "application/pdf")).toBe(
      `courses/${COURSE}/materials/${LECTURE}/file.pdf`,
    );
    expect(courseMaterialObjectPath(COURSE, LECTURE, "image/png")).toMatch(/file\.png$/);
    expect(courseMaterialObjectPath(COURSE, LECTURE, "video/mp4")).toMatch(/file\.mp4$/);
    expect(
      courseMaterialObjectPath(
        COURSE,
        LECTURE,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toMatch(/file\.docx$/);
  });

  it("refuses non-UUID ids so a path can never carry user input", () => {
    expect(() => courseMaterialObjectPath("../etc", LECTURE, "application/pdf")).toThrow();
    expect(() => courseMaterialObjectPath(COURSE, "x/y", "application/pdf")).toThrow();
  });

  it("only accepts the allowlisted container types", () => {
    expect(isCourseFileMimeType("application/pdf")).toBe(true);
    expect(isCourseFileMimeType("video/mp4")).toBe(true);
    expect(isCourseFileMimeType("application/x-sh")).toBe(false);
    expect(isCourseFileMimeType(null)).toBe(false);
    expect(extForCourseFileMime("application/pdf")).toBe("pdf");
  });

  it("syllabus MIME is PDF-only, a strict subset of the bucket allowlist", () => {
    expect(isSyllabusMimeType("application/pdf")).toBe(true);
    expect(isSyllabusMimeType("image/png")).toBe(false);
    expect(isSyllabusMimeType(null)).toBe(false);
  });

  it("has a sane upload ceiling", () => {
    expect(COURSE_FILE_MAX_BYTES).toBe(2 * 1024 ** 3);
  });
});
