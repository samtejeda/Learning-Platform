"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertRole, assertUser } from "@/lib/auth/session";
import { findOwnedCourse } from "@/lib/data/courses";
import {
  deleteExam as deleteExamRow,
  deleteQuestion as deleteQuestionRow,
  getOwnedExam,
  gradeSubmission as gradeSubmissionRow,
  insertExam,
  insertQuestion,
  publishExam as publishExamRow,
  reorderQuestions as reorderQuestionRows,
  unpublishExam as unpublishExamRow,
  updateExam as updateExamRow,
  updateQuestion as updateQuestionRow,
} from "@/lib/data/exams";
import { startAttempt, submitAttempt } from "@/lib/data/exam-attempts";
import { enforceRateLimit } from "@/lib/rate-limit";
import { parseFormData, parseObject, type ActionState } from "@/lib/validation/form";
import {
  answersSchema,
  createQuestionSchema,
  examFormSchema,
  gradeSchema,
  questionFieldsSchema,
  reorderQuestionsSchema,
  startAttemptSchema,
  uuidSchema,
} from "@/lib/validation/exams";

// Conventions (API.md): assertRole/assertUser first; bound ids are untrusted
// (uuid-validated, then ownership/enrollment inside the data-layer query);
// expected failures return ActionState, never throw; redirect() only on
// success. Exams are never auto-graded: nothing here computes a score.

const EXAM_NOT_FOUND = "Exam not found.";
const LOCKED = "This exam is published or already has attempts, so it can't be changed. Unpublish it first (only possible before anyone has started).";

function revalidateExam(examId: string, courseId?: string) {
  revalidatePath(`/professor/exams/${examId}`);
  if (courseId) {
    revalidatePath(`/professor/courses/${courseId}`);
    revalidatePath(`/courses/${courseId}`);
  }
}

// ─── Professor: exam ──────────────────────────────────────────────────────────

export async function createExam(courseId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { error: "Course not found." };
  const parsed = parseFormData(examFormSchema, formData);
  if (!parsed.ok) return parsed.state;
  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { error: "Course not found." };
  const { id } = await insertExam(owned.id, parsed.data);
  revalidatePath(`/professor/courses/${owned.id}`);
  redirect(`/professor/exams/${id}`);
}

export async function updateExam(examId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(examId);
  if (!id.success) return { error: EXAM_NOT_FOUND };
  const parsed = parseFormData(examFormSchema, formData);
  if (!parsed.ok) return parsed.state;
  const result = await updateExamRow(id.data, user, parsed.data);
  if (result === "not_found") return { error: EXAM_NOT_FOUND };
  if (result === "locked") return { error: LOCKED };
  revalidateExam(id.data);
  return { success: "Saved." };
}

export async function deleteExam(examId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(examId);
  if (!id.success) return { error: EXAM_NOT_FOUND };
  const exam = await getOwnedExam(id.data, user);
  if (!exam) return { error: EXAM_NOT_FOUND };
  const result = await deleteExamRow(id.data, user);
  if (result === "not_found") return { error: EXAM_NOT_FOUND };
  if (result === "locked") return { error: "Students have started this exam, so it can't be deleted." };
  revalidateExam(id.data, exam.courseId);
  redirect(`/professor/courses/${exam.courseId}`);
}

export async function publishExam(examId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(examId);
  if (!id.success) return { error: EXAM_NOT_FOUND };
  const result = await publishExamRow(id.data, user);
  if (!result.ok) {
    if (result.reason === "not_found") return { error: EXAM_NOT_FOUND };
    return {
      error: "This exam isn't ready to publish.",
      fieldErrors: {
        _publish: result.problems.map((p) => (p.question ? `Question ${p.question}: ${p.message}` : p.message)),
      },
    };
  }
  revalidateExam(id.data, result.courseId);
  return { success: "Published. Enrolled students can now see it." };
}

export async function unpublishExam(examId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(examId);
  if (!id.success) return { error: EXAM_NOT_FOUND };
  const result = await unpublishExamRow(id.data, user);
  if (result === "not_found") return { error: EXAM_NOT_FOUND };
  if (result === "locked") return { error: "Students have started this exam, so it can't be unpublished." };
  revalidateExam(id.data);
  return { success: "Unpublished." };
}

// ─── Professor: questions ─────────────────────────────────────────────────────

function questionResultState(r: { result: string; error?: string }): ActionState {
  switch (r.result) {
    case "not_found":
      return { error: "Question not found." };
    case "locked":
      return { error: LOCKED };
    case "invalid":
      return { error: r.error ?? "Invalid question." };
    case "too_many":
      return { error: "This exam has the maximum number of questions." };
    default:
      return null;
  }
}

export async function createQuestion(examId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(examId);
  if (!id.success) return { error: EXAM_NOT_FOUND };
  const parsed = parseFormData(createQuestionSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { type, ...fields } = parsed.data;
  const r = await insertQuestion(id.data, user, type, fields);
  const failure = questionResultState(r);
  if (failure) return failure.error === "Question not found." ? { error: EXAM_NOT_FOUND } : failure;
  revalidateExam(id.data);
  return { success: "Question added." };
}

export async function updateQuestion(questionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(questionId);
  if (!id.success) return { error: "Question not found." };
  const parsed = parseFormData(questionFieldsSchema, formData);
  if (!parsed.ok) return parsed.state;
  const r = await updateQuestionRow(id.data, user, parsed.data);
  const failure = questionResultState(r);
  if (failure) return failure;
  revalidatePath("/professor/exams", "layout");
  return { success: "Saved." };
}

export async function deleteQuestion(questionId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(questionId);
  if (!id.success) return { error: "Question not found." };
  const r = await deleteQuestionRow(id.data, user);
  if (r === "not_found") return { error: "Question not found." };
  if (r === "locked") return { error: LOCKED };
  revalidatePath("/professor/exams", "layout");
  return { success: "Question deleted." };
}

export async function reorderQuestions(examId: string, input: unknown): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(examId);
  if (!id.success) return { error: EXAM_NOT_FOUND };
  const parsed = parseObject(reorderQuestionsSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return parsed.state;
  const r = await reorderQuestionRows(id.data, user, parsed.data.orderedIds);
  if (r === "not_found") return { error: EXAM_NOT_FOUND };
  if (r === "locked") return { error: LOCKED };
  if (r === "mismatch") return { error: "The question list changed. Refresh and try again." };
  revalidateExam(id.data);
  return { success: "Order saved." };
}

// ─── Professor: grading (manual, every question type) ─────────────────────────

/** Form fields: `grade`, `feedback`, and one `comment:<questionId>` per answer. */
export async function gradeSubmission(submissionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(submissionId);
  if (!id.success) return { error: "Submission not found." };

  const answerFeedback: Record<string, string> = {};
  const flat: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key.startsWith("comment:")) answerFeedback[key.slice("comment:".length)] = value;
    else flat[key] = value;
  }
  const parsed = parseObject(gradeSchema, { ...flat, answerFeedback });
  if (!parsed.ok) return parsed.state;

  const r = await gradeSubmissionRow(id.data, user, parsed.data);
  if (r.result === "not_found") return { error: "Submission not found." };
  if (r.result === "not_submitted") return { error: "This attempt hasn't been submitted yet." };
  revalidatePath(`/professor/exams/${r.examId}`, "layout");
  revalidatePath(`/courses/${r.courseId}`, "layout");
  return { success: "Grade saved." };
}

// ─── Student: attempts ────────────────────────────────────────────────────────

/** Begin (or resume) an attempt in the chosen language, then go to it. */
export async function startExamAttempt(examId: string, courseId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertUser();
  const eid = uuidSchema.safeParse(examId);
  const cid = uuidSchema.safeParse(courseId);
  if (!eid.success || !cid.success) return { error: EXAM_NOT_FOUND };
  const parsed = parseFormData(startAttemptSchema, formData);
  if (!parsed.ok) return parsed.state;
  const limited = await enforceRateLimit("exam_attempt", user.id);
  if (limited) return { error: limited };
  const r = await startAttempt(eid.data, user.id, parsed.data.language);
  if (!r.ok) {
    return { error: r.reason === "no_attempts_left" ? "You have no attempts left on this exam." : EXAM_NOT_FOUND };
  }
  revalidatePath(`/courses/${cid.data}`);
  redirect(`/courses/${cid.data}/exams/${eid.data}/attempt/${r.attemptId}`);
}

/** Final submit. Called from the attempt page with the current answers. */
export async function submitExamAttempt(attemptId: string, input: unknown): Promise<ActionState> {
  const user = await assertUser();
  const id = uuidSchema.safeParse(attemptId);
  if (!id.success) return { error: "Attempt not found." };
  const parsed = parseObject(answersSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return parsed.state;
  const limited = await enforceRateLimit("exam_attempt", user.id);
  if (limited) return { error: limited };
  const r = await submitAttempt(id.data, user.id, parsed.data.answers);
  if (!r.ok) {
    switch (r.reason) {
      case "not_found":
        return { error: "Attempt not found." };
      case "already_submitted":
        return { error: "This attempt was already submitted." };
      case "expired":
        return { error: "Time ran out. Your saved answers were submitted." };
      default:
        return { error: r.error ?? "Invalid answers." };
    }
  }
  revalidatePath("/courses", "layout");
  return { success: "Submitted." };
}
