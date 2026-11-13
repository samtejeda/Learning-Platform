import { z } from "zod";
import { courseTitleSchema, optionalDescriptionSchema, uuidSchema } from "./courses";
import { LECTURE_MAX_BYTES, LECTURE_MIME_TYPES } from "@/lib/storage/paths";
import { parseYoutubeLink } from "@/lib/video/youtube";

/** Title/description for create and edit. */
export const lectureFormSchema = z.object({
  title: courseTitleSchema,
  description: optionalDescriptionSchema,
});

/** Step 1 of an upload: what the professor is about to send. */
export const createLectureSchema = lectureFormSchema.extend({
  contentType: z.enum(LECTURE_MIME_TYPES, { error: "Only MP4 (H.264) video files are accepted. See docs/ENCODING.md." }),
  sizeBytes: z
    .number({ error: "File size is required." })
    .int()
    .positive("The file is empty.")
    .max(LECTURE_MAX_BYTES, "That file is too large."),
});

/**
 * A lecture's length, which becomes the 95% denominator. It must come from the
 * PROFESSOR's side (their browser at finalize, or their manual entry for a
 * YouTube lecture), never from a student's request.
 */
const durationNumber = z
  .number({ error: "Duration is required." })
  .finite({ error: "Duration is required." })
  .min(1, "Duration must be at least one second.")
  .max(24 * 60 * 60, "Duration is implausibly long.");

/** Step 3: the professor's browser read the media duration. */
export const finalizeLectureSchema = z.object({
  durationSeconds: durationNumber,
});

/** Duration from JSON (a number) or a form (a numeric string); nothing else. */
const durationInput = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  durationNumber,
);

/** A pasted YouTube link → the 11-character id. The URL itself is never stored or fetched. */
export const youtubeLinkSchema = z
  .string({ error: "A YouTube link is required." })
  .transform((value, ctx) => {
    const parsed = parseYoutubeLink(value);
    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        message: "That isn't a YouTube video link. Paste a youtube.com/watch, youtu.be, shorts or embed link for a single video.",
      });
      return z.NEVER;
    }
    return parsed.videoId;
  });

/** Create a YouTube lecture (draft). */
export const createYoutubeLectureSchema = lectureFormSchema.extend({
  youtubeUrl: youtubeLinkSchema,
  durationSeconds: durationInput,
});

/** Blank form fields mean "leave unchanged". */
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/**
 * Edit: title/description always; link and duration only take effect on a
 * YouTube lecture (the action refuses them for an uploaded one).
 */
export const updateLectureSchema = lectureFormSchema.extend({
  youtubeUrl: z.preprocess(blankToUndefined, youtubeLinkSchema.optional()),
  durationSeconds: z.preprocess(blankToUndefined, durationInput.optional()),
});

export const reorderLecturesSchema = z.object({
  orderedIds: z
    .array(uuidSchema)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate lecture ids."),
});

export { uuidSchema };
