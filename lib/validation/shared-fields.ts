import { z } from "zod";
import { MC_MAX_OPTIONS, OPTION_MAX_LENGTH } from "@/lib/exams/limits";

// Form-field building blocks shared by the exams and lecture-comprehension
// validation. Pure; no DB or Next imports.

/** Optional text: trimmed, empty → null (drafts may be incomplete). */
export const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

export const intField = (min: number, max: number, label: string) =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);

/**
 * One option per line → string[]. A blank line BEFORE the last option is an
 * error, never dropped: dropping it would shift every later position, and the
 * stored key is a position. Trailing blank lines (e.g. the textarea's final
 * newline) are trimmed; they can't shift anything.
 */
export const optionLines = (label: string) =>
  z
    .string()
    .max(MC_MAX_OPTIONS * (OPTION_MAX_LENGTH + 2), `${label} are too long.`)
    .optional()
    .transform((v, ctx) => {
      const lines = (v ?? "").split(/\r?\n/).map((l) => l.trim());
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      if (lines.some((l) => l === "")) {
        ctx.addIssue({
          code: "custom",
          message: "Options can't have an empty line between them. Remove the empty line or type the option.",
        });
        return z.NEVER;
      }
      return lines;
    })
    .pipe(
      z
        .array(z.string().max(OPTION_MAX_LENGTH, `Each option must be at most ${OPTION_MAX_LENGTH} characters.`))
        .max(MC_MAX_OPTIONS, `At most ${MC_MAX_OPTIONS} options.`),
    );
