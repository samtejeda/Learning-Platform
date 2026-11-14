import { describe, expect, it } from "vitest";
import { YOUTUBE_LOAD_FAILED, YOUTUBE_SOURCE_NOTE, speedNoticeText, youtubeErrorMessage } from "./youtube-messages";

describe("youtube messages", () => {
  it("explains each YouTube error code differently where it matters", () => {
    expect(youtubeErrorMessage(100)).toMatch(/removed or made private/);
    expect(youtubeErrorMessage(101)).toBe(youtubeErrorMessage(150));
    expect(youtubeErrorMessage(101)).toMatch(/doesn't allow/);
    expect(youtubeErrorMessage(2)).toMatch(/link/);
    expect(youtubeErrorMessage(5)).toMatch(/couldn't play/);
  });

  it("names the speed and the 1.5x limit, and never tells the viewer they are blocked", () => {
    const text = speedNoticeText(1.75);
    expect(text).toContain("1.75×");
    expect(text).toContain("1.5×");
    expect(speedNoticeText(2)).toContain("2×");
    expect(text).not.toMatch(/can't|cannot|not allowed|blocked/i);
  });

  it("offers no link away from the player", () => {
    for (const text of [YOUTUBE_LOAD_FAILED, YOUTUBE_SOURCE_NOTE, youtubeErrorMessage(100)]) {
      expect(text).not.toMatch(/https?:|youtube\.com|open on youtube/i);
    }
  });
});
