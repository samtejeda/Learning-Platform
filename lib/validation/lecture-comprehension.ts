import { z } from "zod";
import { uuidSchema } from "./courses";
import { intField, optionalText, optionLines } from "./shared-fields";
import { COMPREHENSION_MAX_OPTIONS, PROMPT_MAX_LENGTH } from "@/lib/lectures/comprehension";

export { uuidSchema };

const optionalKey = z
  .union([z.literal(""), intField(0, COMPREHENSION_MAX_OPTIONS - 1, "Correct answer")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

/**
 * The professor's form for both question slots. Field names are flat
 * (`q1PromptEs`, `q2OptionsEn`, …) so a plain <form> posts them. Everything is
 * optional here (drafts may be incomplete); completeness is enforced by the
 * enabled gate in lib/lectures/comprehension.ts, never by the form.
 */
export const comprehensionFormSchema = z
  .object({
    q1PromptEs: optionalText(PROMPT_MAX_LENGTH, "Question 1 (Spanish)"),
    q1PromptEn: optionalText(PROMPT_MAX_LENGTH, "Question 1 (English)"),
    q1OptionsEs: optionLines("Question 1 Spanish options"),
    q1OptionsEn: optionLines("Question 1 English options"),
    q1Correct: optionalKey,
    q2PromptEs: optionalText(PROMPT_MAX_LENGTH, "Question 2 (Spanish)"),
    q2PromptEn: optionalText(PROMPT_MAX_LENGTH, "Question 2 (English)"),
    q2OptionsEs: optionLines("Question 2 Spanish options"),
    q2OptionsEn: optionLines("Question 2 English options"),
    q2Correct: optionalKey,
  })
  .transform((f) => ({
    slots: [
      { promptEs: f.q1PromptEs, promptEn: f.q1PromptEn, optionsEs: f.q1OptionsEs, optionsEn: f.q1OptionsEn, correctOption: f.q1Correct },
      { promptEs: f.q2PromptEs, promptEn: f.q2PromptEn, optionsEs: f.q2OptionsEs, optionsEn: f.q2OptionsEn, correctOption: f.q2Correct },
    ] as const,
  }));

/**
 * A student's answer: the chosen option's POSITION. Language-independent, so a
 * Spanish and an English reader are scored identically. Strict: no extra keys.
 */
export const comprehensionAnswerSchema = z
  .object({
    selectedOption: z
      .number({ error: "Choose an option." })
      .int()
      .min(0)
      .max(COMPREHENSION_MAX_OPTIONS - 1),
  })
  .strict();
