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
  type EditOutcome,
} from "@/lib/data/exams";
import { ATTEMPT_BLOCK_MESSAGES } from "@/lib/exams/edit-rules";
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

/** Map an edit outcome to an ActionState (null = success). */
function editFailure(r: EditOutcome, notFound: string): ActionState {
  switch (r.result) {
    case "ok":
      return null;
    case "not_found":
      return { error: notFound };
    case "attempts_block":
      return { error: ATTEMPT_BLOCK_MESSAGES[r.reason] };
    case "incomplete":
      return {
        error: `This exam is published, so an edit must keep it complete in both languages. Nothing was saved. ${r.problems
          .map((p) => (p.question ? `Question ${p.question}: ${p.message}` : p.message))
          .join(" ")}`,
      };
    case "invalid":
      return { error: r.error };
    case "too_many":
      return { error: "This exam has the maximum number of questions." };
    case "mismatch":
      return { error: "The question list changed. Refresh and try again." };
  }
}

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
  const failure = editFailure(result, EXAM_NOT_FOUND);
  if (failure) return failure;
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
  if (result === "has_attempts") return { error: "Students have started this exam, so it can't be deleted (their work would be lost). You can unpublish it instead." };
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
  revalidateExam(id.data);
  return { success: "Unpublished." };
}

// ─── Professor: questions ─────────────────────────────────────────────────────

export async function createQuestion(examId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(examId);
  if (!id.success) return { error: EXAM_NOT_FOUND };
  const parsed = parseFormData(createQuestionSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { type, ...fields } = parsed.data;
  const r = await insertQuestion(id.data, user, type, fields);
  const failure = editFailure(r, EXAM_NOT_FOUND);
  if (failure) return failure;
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
  const failure = editFailure(r, "Question not found.");
  if (failure) return failure;
  revalidatePath("/professor/exams", "layout");
  return { success: "Saved." };
}

export async function deleteQuestion(questionId: string): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(questionId);
  if (!id.success) return { error: "Question not found." };
  const r = await deleteQuestionRow(id.data, user);
  const failure = editFailure(r, "Question not found.");
  if (failure) return failure;
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
  const failure = editFailure(r, EXAM_NOT_FOUND);
  if (failure) return failure;
  revalidateExam(id.data);
  return { success: "Order saved." };
}

// ─── Professor: grading (manual, every question type) ─────────────────────────

/** Form fields: `feedback`, one `points:<questionId>` per answered manual question, and one `comment:<questionId>` per answer. */
export async function gradeSubmission(submissionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(submissionId);
  if (!id.success) return { error: "Submission not found." };

  const answerFeedback: Record<string, string> = {};
  const answerPoints: Record<string, string> = {};
  const flat: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key.startsWith("comment:")) answerFeedback[key.slice("comment:".length)] = value;
    else if (key.startsWith("points:")) answerPoints[key.slice("points:".length)] = value;
    else flat[key] = value;
  }
  // Echo what was typed so a refused save keeps every field populated.
  const typed: Record<string, string> = { ...flat };
  for (const [qid, v] of Object.entries(answerPoints)) typed[`points:${qid}`] = v;
  const parsed = parseObject(gradeSchema, { ...flat, answerFeedback, answerPoints });
  if (!parsed.ok) return { ...parsed.state, values: typed };

  const r = await gradeSubmissionRow(id.data, user, parsed.data);
  if (r.result === "not_found") return { error: "Submission not found." };
  if (r.result === "not_submitted") return { error: "This attempt hasn't been submitted yet." };
  if (r.result === "invalid") return { error: r.error ?? "Invalid points.", values: typed };
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
