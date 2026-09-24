import { z } from "zod";
import { uuidSchema } from "./courses";
import { COURSE_FILE_MAX_BYTES, SYLLABUS_MIME_TYPES } from "@/lib/storage/paths";

/** Step 1 of an upload: what the professor is about to send. PDF-only. */
export const uploadSyllabusSchema = z.object({
  contentType: z.enum(SYLLABUS_MIME_TYPES, { error: "Only PDF files are accepted." }),
  sizeBytes: z
    .number({ error: "File size is required." })
    .int()
    .positive("The file is empty.")
    .max(COURSE_FILE_MAX_BYTES, "That file is too large."),
});

export { uuidSchema };
