import { z } from "zod";

/** Route param / bound-argument ids. Always validated before any query. */
export const uuidSchema = z.uuid({ error: "Invalid id." });

export const courseTitleSchema = z
  .string({ error: "Title is required." })
  .trim()
  .min(1, "Title is required.")
  .max(120, "Title must be at most 120 characters.");

/** Optional free text; empty string becomes null so the column stays clean. */
export const optionalDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be at most 2000 characters.")
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const courseFormSchema = z.object({
  title: courseTitleSchema,
  description: optionalDescriptionSchema,
});

export type CourseFormInput = z.output<typeof courseFormSchema>;
