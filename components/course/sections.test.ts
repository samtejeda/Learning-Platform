import { describe, expect, it } from "vitest";
import { COURSE_SECTIONS, collapsedStorageKey, parseCollapsed, sectionsFor } from "./sections";

describe("course sections", () => {
  it("has the order Sam fixed", () => {
    expect(sectionsFor("student").map((s) => s.id)).toEqual(["syllabus", "lectures", "materials", "exams"]);
    expect(sectionsFor("professor").map((s) => s.id)).toEqual(["syllabus", "lectures", "materials", "exams", "students"]);
  });

  it("students only get sections that have content; professors keep theirs", () => {
    const ids = sectionsFor("student", { syllabus: false, materials: false }).map((s) => s.id);
    expect(ids).toEqual(["lectures", "exams"]);
    expect(sectionsFor("professor").length).toBe(5);
  });

  it("never lists the roster for students", () => {
    expect(sectionsFor("student", { students: true }).some((s) => s.id === "students")).toBe(false);
  });

  it("has unique ids and labels for chips", () => {
    expect(new Set(COURSE_SECTIONS.map((s) => s.id)).size).toBe(COURSE_SECTIONS.length);
    expect(COURSE_SECTIONS.map((s) => s.chip)).toEqual(["Syllabus", "Lectures", "Materials", "Exams", "Students"]);
  });

  it("reads remembered state defensively", () => {
    expect(parseCollapsed(null)).toEqual([]);
    expect(parseCollapsed("not json")).toEqual([]);
    expect(parseCollapsed('{"a":1}')).toEqual([]);
    expect(parseCollapsed('["lectures","bogus",3,"exams"]')).toEqual(["lectures", "exams"]);
  });

  it("keys storage per view and course", () => {
    expect(collapsedStorageKey("student", "c1")).not.toBe(collapsedStorageKey("professor", "c1"));
    expect(collapsedStorageKey("student", "c1")).not.toBe(collapsedStorageKey("student", "c2"));
  });
});
