import { z } from "zod";
import { courseTitleSchema, optionalDescriptionSchema, uuidSchema } from "./courses";
import { COURSE_FILE_MAX_BYTES, COURSE_FILE_MIME_TYPES } from "@/lib/storage/paths";

/** Title/description for editing an existing material (either kind). */
export const materialFormSchema = z.object({
  title: courseTitleSchema,
  description: optionalDescriptionSchema,
});

/** http(s) only — never fetched server-side, so this is the only real
 * validation surface; no SSRF risk since it's rendered as a plain <a>. */
const materialUrlSchema = z
  .url({ protocol: /^https?$/, error: "Enter a valid http:// or https:// URL." })
  .max(2000, "URL is too long.");

/** Step 1 of a file-kind upload: what the professor is about to send. */
export const createFileMaterialSchema = materialFormSchema.extend({
  kind: z.literal("file"),
  contentType: z.enum(COURSE_FILE_MIME_TYPES, { error: "That file type isn't supported." }),
  sizeBytes: z
    .number({ error: "File size is required." })
    .int()
    .positive("The file is empty.")
    .max(COURSE_FILE_MAX_BYTES, "That file is too large."),
});

/** A link-kind material is created in one step — no upload/finalize. */
export const createLinkMaterialSchema = materialFormSchema.extend({
  kind: z.literal("link"),
  url: materialUrlSchema,
});

export const createMaterialSchema = z.discriminatedUnion("kind", [
  createFileMaterialSchema,
  createLinkMaterialSchema,
]);

/** Step 3 of a file-kind upload: nothing from the client is trusted here —
 * the server re-reads the object's content type from Storage itself. Kept
 * as an explicit schema (rather than skipping validation) for the same
 * "every entry point validates its input" convention as the rest of the app. */
export const finalizeMaterialSchema = z.object({}).strict();

export const reorderMaterialsSchema = z.object({
  orderedIds: z
    .array(uuidSchema)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate material ids."),
});

export { uuidSchema };
