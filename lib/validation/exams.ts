import { z } from "zod";
import { uuidSchema } from "./courses";
import { CONTENT_LANGUAGES } from "@/lib/exams/language";
import {
  ANSWER_FEEDBACK_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  ESSAY_ANSWER_MAX_LENGTH,
  FEEDBACK_MAX_LENGTH,
  MAX_QUESTIONS_PER_EXAM,
  MC_MAX_OPTIONS,
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
          })
          .strict(),
      )
      .max(MAX_QUESTIONS_PER_EXAM),
  })
  .strict();

// ─── Grading ──────────────────────────────────────────────────────────────────

export const gradeSchema = z.object({
  // A blank field must not coerce to 0, so require a non-empty string first.
  grade: z
    .string({ error: "Grade is required." })
    .trim()
    .min(1, "Grade is required.")
    .transform((v) => Number(v))
    .pipe(
      z
        .number({ error: "Grade must be a number." })
        .min(0, "Grade must be between 0 and 100.")
        .max(100, "Grade must be between 0 and 100."),
    ),
  feedback: optionalText(FEEDBACK_MAX_LENGTH, "Feedback"),
  answerFeedback: z
    .record(uuidSchema, z.string().trim().max(ANSWER_FEEDBACK_MAX_LENGTH, "An answer comment is too long."))
    .default({}),
});
export type GradeInput = z.output<typeof gradeSchema>;
