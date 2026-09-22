import { describe, expect, it } from "vitest";
import { courseFormSchema, uuidSchema } from "./courses";

describe("courseFormSchema", () => {
  it("trims the title and turns an empty description into null", () => {
    const r = courseFormSchema.safeParse({ title: "  Romans  ", description: "   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ title: "Romans", description: null });
  });

  it("accepts a missing description", () => {
    const r = courseFormSchema.safeParse({ title: "Romans" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeNull();
  });

  it("rejects an empty or oversized title", () => {
    expect(courseFormSchema.safeParse({ title: "" }).success).toBe(false);
    expect(courseFormSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
  });

  it("rejects an oversized description", () => {
    expect(courseFormSchema.safeParse({ title: "ok", description: "x".repeat(2001) }).success).toBe(
      false,
    );
  });
});

describe("uuidSchema", () => {
  it("accepts a v4 uuid and rejects anything else", () => {
    expect(uuidSchema.safeParse("11111111-1111-4111-8111-111111111111").success).toBe(true);
    expect(uuidSchema.safeParse("1; drop table courses").success).toBe(false);
    expect(uuidSchema.safeParse("").success).toBe(false);
  });
});
