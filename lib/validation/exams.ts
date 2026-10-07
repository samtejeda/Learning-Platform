import { z } from "zod";
import { uuidSchema } from "./courses";
import { MAX_BLANKS } from "@/lib/exams/blanks";
import { CONTENT_LANGUAGES } from "@/lib/exams/language";
import {
  ANSWER_FEEDBACK_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  ESSAY_ANSWER_MAX_LENGTH,
  FILL_ANSWER_MAX_LENGTH,
  FEEDBACK_MAX_LENGTH,
  MAX_QUESTIONS_PER_EXAM,
  MAX_POINTS,
  MC_MAX_OPTIONS,
  MIN_POINTS,
  OPTION_MAX_LENGTH,
  PROMPT_MAX_LENGTH,
  REFERENCE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from "@/lib/exams/limits";

export { uuidSchema };

/** Optional text: trimmed, empty → null (drafts may be incomplete). */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

const intField = (min: number, max: number, label: string) =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);

export const contentLanguageSchema = z.enum(CONTENT_LANGUAGES, { error: "Choose a language." });

export const examFormSchema = z.object({
  titleEs: optionalText(TITLE_MAX_LENGTH, "Spanish title"),
  titleEn: optionalText(TITLE_MAX_LENGTH, "English title"),
  descriptionEs: optionalText(DESCRIPTION_MAX_LENGTH, "Spanish description"),
  descriptionEn: optionalText(DESCRIPTION_MAX_LENGTH, "English description"),
  maxAttempts: intField(1, 10, "Attempts"),
  durationMinutes: intField(1, 480, "Time limit"),
  // Checkbox: present ("on"/"true") = reveal, absent = off.
  revealKeysAfterAttempts: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
    .optional()
    .transform((v) => v === "on" || v === "true"),
});
export type ExamFormInput = z.output<typeof examFormSchema>;

/** One option per line → string[] (blank lines dropped). */
const optionLines = (label: string) =>
  z
    .string()
    .max(MC_MAX_OPTIONS * (OPTION_MAX_LENGTH + 2), `${label} are too long.`)
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    )
    .pipe(
      z
        .array(z.string().max(OPTION_MAX_LENGTH, `Each option must be at most ${OPTION_MAX_LENGTH} characters.`))
        .max(MC_MAX_OPTIONS, `At most ${MC_MAX_OPTIONS} options.`),
    );

const optionalKey = z
  .union([z.literal(""), intField(0, MC_MAX_OPTIONS - 1, "Key")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/** The fields a professor edits on a question. `type` is chosen once at
 * creation (create schema) and never changes. */
export const questionFieldsSchema = z.object({
  promptEs: optionalText(PROMPT_MAX_LENGTH, "Spanish prompt"),
  promptEn: optionalText(PROMPT_MAX_LENGTH, "English prompt"),
  optionsEs: optionLines("Spanish options"),
  optionsEn: optionLines("English options"),
  correctOption: optionalKey,
  referenceAnswerEs: optionalText(REFERENCE_MAX_LENGTH, "Spanish reference answer"),
  referenceAnswerEn: optionalText(REFERENCE_MAX_LENGTH, "English reference answer"),
  // Weight in points. Omitted = unchanged on update, 1 on create.
  points: z
    .preprocess((v) => (v === "" ? undefined : v), intField(MIN_POINTS, MAX_POINTS, "Points").optional()),
});
export type QuestionFieldsInput = z.output<typeof questionFieldsSchema>;

export const questionTypeSchema = z.enum(
  ["multiple_choice", "true_false", "fill_in_the_blank", "short_essay"],
  { error: "Choose a question type." },
);

export const createQuestionSchema = questionFieldsSchema.extend({ type: questionTypeSchema });

export const reorderQuestionsSchema = z.object({
  orderedIds: z
    .array(uuidSchema)
    .min(1)
    .max(MAX_QUESTIONS_PER_EXAM)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate question ids."),
});

// ─── Student attempt ──────────────────────────────────────────────────────────

export const startAttemptSchema = z.object({ language: contentLanguageSchema }).strict();

/** Same shape for autosave and final submit; type-specific checks happen
 * against the real questions in lib/exams/answers.ts. */
export const answersSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: uuidSchema,
            selectedOption: z.number().int().min(0).max(MC_MAX_OPTIONS - 1).optional(),
            answerText: z.string().max(ESSAY_ANSWER_MAX_LENGTH).optional(),
            // fill in the blank with blanks in the prompt: one entry per blank
            blanks: z.array(z.string().max(FILL_ANSWER_MAX_LENGTH)).max(MAX_BLANKS).optional(),
          })
          .strict(),
      )
      .max(MAX_QUESTIONS_PER_EXAM),
  })
  .strict();

// ─── Grading ──────────────────────────────────────────────────────────────────

/** Half-point steps: 0, 0.5, 1, … */
const pointsValue = z
  .string()
  .trim()
  .min(1, "Points are required.")
  .transform((v) => Number(v))
  .pipe(
    z
      .number({ error: "Points must be a number." })
      .min(0, "Points can't be negative.")
      .max(MAX_POINTS, `Points can be at most ${MAX_POINTS}.`)
      .refine((n) => Number.isInteger(n * 2), "Use whole or half points (for example 2 or 2.5)."),
  );

/** Manual grading: points per manual question (the form sends one
 * `points:<questionId>` per answered fill/essay question), overall feedback,
 * and optional per-answer comments. Bounds against each question's weight
 * are checked in the data layer, which knows the weights. */
export const gradeSchema = z.object({
  feedback: optionalText(FEEDBACK_MAX_LENGTH, "Feedback"),
  answerPoints: z.record(uuidSchema, pointsValue).default({}),
  answerFeedback: z
    .record(uuidSchema, z.string().trim().max(ANSWER_FEEDBACK_MAX_LENGTH, "An answer comment is too long."))
    .default({}),
});
export type GradeInput = z.output<typeof gradeSchema>;
