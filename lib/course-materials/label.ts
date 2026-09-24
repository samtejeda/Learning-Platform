/** Short, human type label for a material — used for the row badge on both
 * the professor manager and the student list. Pure so it's unit-testable
 * and shared without pulling any UI into lib/. */
export function materialTypeLabel(kind: "file" | "link", mimeType: string | null): string {
  if (kind === "link") return "Link";
  if (!mimeType) return "File";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.includes("word")) return "Document";
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation")) return "Slides";
  return "File";
}
