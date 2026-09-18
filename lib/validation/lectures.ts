import { z } from "zod";
import { courseTitleSchema, optionalDescriptionSchema, uuidSchema } from "./courses";
import { LECTURE_MAX_BYTES, LECTURE_MIME_TYPES } from "@/lib/storage/paths";

/** Title/description for create and edit. */
export const lectureFormSchema = z.object({
  title: courseTitleSchema,
  description: optionalDescriptionSchema,
});

/** Step 1 of an upload: what the professor is about to send. */
export const createLectureSchema = lectureFormSchema.extend({
  contentType: z.enum(LECTURE_MIME_TYPES, { error: "Only MP4, WebM, or MOV video files are accepted." }),
  sizeBytes: z
    .number({ error: "File size is required." })
    .int()
    .positive("The file is empty.")
    .max(LECTURE_MAX_BYTES, "That file is too large."),
});

/** Step 3: the professor's browser read the media duration. */
export const finalizeLectureSchema = z.object({
  durationSeconds: z
    .number({ error: "Duration is required." })
    .finite()
    .min(1, "Duration must be at least one second.")
    .max(24 * 60 * 60, "Duration is implausibly long."),
});

export const reorderLecturesSchema = z.object({
  orderedIds: z
    .array(uuidSchema)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate lecture ids."),
});

export { uuidSchema };
