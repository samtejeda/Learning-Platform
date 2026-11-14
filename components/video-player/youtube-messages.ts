// Plain-language messages for the YouTube player. Interface text only.

export const YOUTUBE_LOAD_FAILED =
  "The YouTube player couldn't load. An ad blocker, a network filter or your connection may be blocking YouTube. Try again, or turn the blocker off for this site.";

/** Shown below the player (never over it) when YouTube reports an error code. */
export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return "YouTube didn't accept this video link.";
    case 100:
      return "This video was removed or made private on YouTube.";
    case 101:
    case 150:
      return "The owner of this video doesn't allow it to be played outside YouTube.";
    default:
      return "YouTube couldn't play this video.";
  }
}

/** Where the "tell your professor" nudge goes, for students. */
export const YOUTUBE_ERROR_HELP = "Try again in a moment. If it keeps happening, tell your professor.";

/** Note under a lecture that plays from YouTube. */
export const YOUTUBE_SOURCE_NOTE =
  "This video plays from YouTube, so it may show ads or suggested videos. Watch it here for your progress to count.";

/** Shown when the viewer's speed is above what the server counts in full. */
export function speedNoticeText(rate: number): string {
  const shown = Number.isInteger(rate) ? String(rate) : String(Math.round(rate * 100) / 100);
  return `You're watching at ${shown}× speed. Progress counts only up to about 1.5× speed, so some of what you watch at this speed may not count. Slow down to be sure this lecture is marked complete.`;
}
