import { describe, expect, it } from "vitest";
import { optionEditBlock } from "./edit-rules";

const stored = { optionsEs: ["a", "b", "c"], optionsEn: ["x", "y", "z"] };

describe("optionEditBlock", () => {
  it("allows wording fixes and unchanged options", () => {
    expect(optionEditBlock(stored, { optionsEs: ["a", "b", "c"], optionsEn: ["x", "y", "z"] })).toBeNull();
    expect(optionEditBlock(stored, { optionsEs: ["a", "B!", "c"], optionsEn: ["x", "y", "z2"] })).toBeNull();
  });
  it("blocks adding or removing an option in either language", () => {
    expect(optionEditBlock(stored, { optionsEs: ["a", "b"], optionsEn: ["x", "y", "z"] })).toBe("option_count");
    expect(optionEditBlock(stored, { optionsEs: ["a", "b", "c"], optionsEn: ["x", "y", "z", "w"] })).toBe("option_count");
  });
  it("blocks a pure reorder in either language", () => {
    expect(optionEditBlock(stored, { optionsEs: ["b", "a", "c"], optionsEn: ["x", "y", "z"] })).toBe("option_order");
    expect(optionEditBlock(stored, { optionsEs: ["a", "b", "c"], optionsEn: ["z", "y", "x"] })).toBe("option_order");
  });
});
