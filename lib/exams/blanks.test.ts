import { describe, expect, it } from "vitest";
import { BLANK_TOKEN, countBlanks, splitOnBlanks } from "./blanks";

describe("blanks", () => {
  it("counts and splits on the token", () => {
    const p = `a ${BLANK_TOKEN} b ${BLANK_TOKEN} c`;
    expect(countBlanks(p)).toBe(2);
    expect(splitOnBlanks(p)).toEqual(["a ", " b ", " c"]);
    expect(countBlanks("none")).toBe(0);
    expect(countBlanks(null)).toBe(0);
  });
});
