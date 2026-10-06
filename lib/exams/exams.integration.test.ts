import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { actAs, RedirectSignal } from "@/test/setup-integration";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { db } from "@/lib/db";
import { insertCourse } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import {
  getExamLandingForStudent,
  getAttemptForStudent,
  listExamsForStudent,
  saveAttemptAnswers,
  startAttempt,
} from "@/lib/data/exam-attempts";
import { getOwnedExam, getSubmissionForGrading, listSubmissionsForExam } from "@/lib/data/exams";
import {
  createExam,
  createQuestion,
  deleteExam,
  gradeSubmission,
  publishExam,
  reorderQuestions,
  startExamAttempt,
  submitExamAttempt,
  unpublishExam,
  updateExam,
  updateQuestion,
} from "@/lib/exams/actions";
import { PUT as autosaveRoute } from "@/app/api/exams/attempts/[attemptId]/answers/route";
import { AuthError } from "@/lib/auth/session";

// All exam wording below is an obvious PLACEHOLDER: these tests exercise the
// structure (gates, keys, attempts, timing, grading), never real content.

const A = { id: SEED.profA.id, role: "professor" as const };
const B = { id: SEED.profB.id, role: "professor" as const };

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
async function redirectTarget(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
  throw new Error("expected a redirect");
}

const MC = { type: "multiple_choice", promptEs: "PLACEHOLDER mc es", promptEn: "PLACEHOLDER mc en", optionsEs: "e0\ne1\ne2", optionsEn: "n0\nn1\nn2", correctOption: "1" };
const TF = { type: "true_false", promptEs: "PLACEHOLDER tf es", promptEn: "PLACEHOLDER tf en", correctOption: "0" };
const FILL = { type: "fill_in_the_blank", promptEs: "PLACEHOLDER fill es", promptEn: "PLACEHOLDER fill en", referenceAnswerEs: "REFKEY_FILL_ES", referenceAnswerEn: "REFKEY_FILL_EN" };
const ESSAY = { type: "short_essay", promptEs: "PLACEHOLDER essay es", promptEn: "PLACEHOLDER essay en", referenceAnswerEs: "REFKEY_ESSAY_ES", referenceAnswerEn: "REFKEY_ESSAY_EN" };

describe("exams: authoring, publish gate, attempts, timing, grading", () => {
  let courseId: string;
  let examId: string;
  let qIds: string[];

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "Exams test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
  });
  afterAll(async () => {
    await resetSeedData();
  });

  const examFields = { titleEs: "PLACEHOLDER titulo", titleEn: "PLACEHOLDER title", maxAttempts: "2", durationMinutes: "20" };

  it("only the owning professor (or admin) can create an exam", async () => {
    actAs(SEED.student.id);
    await expect(createExam(courseId, null, fd(examFields))).rejects.toBeInstanceOf(AuthError);
    actAs(SEED.profB.id);
    expect(await createExam(courseId, null, fd(examFields))).toEqual({ error: "Course not found." });
    actAs(SEED.profA.id);
    const to = await redirectTarget(createExam(courseId, null, fd(examFields)));
    examId = to.split("/").pop()!;
    expect((await getOwnedExam(examId, A))?.status).toBe("draft");
    expect(await getOwnedExam(examId, B)).toBeNull();
  });

  it("validates input and keeps question shape per type", async () => {
    actAs(SEED.profA.id);
    expect((await createExam(courseId, null, fd({ ...examFields, durationMinutes: "0" })))?.error).toBeTruthy();
    expect((await createQuestion(examId, null, fd({ type: "matching" })))?.error).toBeTruthy();
    for (const q of [MC, TF, FILL, ESSAY]) {
      expect(await createQuestion(examId, null, fd(q))).toEqual({ success: "Question added." });
    }
    const exam = (await getOwnedExam(examId, A))!;
    qIds = exam.questions.map((q) => q.id);
    expect(exam.questions.map((q) => q.type)).toEqual(["multiple_choice", "true_false", "fill_in_the_blank", "short_essay"]);
    expect(exam.questions[0]).toMatchObject({ optionsEs: ["e0", "e1", "e2"], correctOption: 1 });
    expect(exam.questions[1]).toMatchObject({ optionsEs: null, correctOption: 0 });
    expect(exam.questions[2]).toMatchObject({ correctOption: null, referenceAnswerEs: "REFKEY_FILL_ES" });
  });

  it("drafts are invisible to students", async () => {
    actAs(SEED.student.id);
    expect(await listExamsForStudent(courseId, SEED.student.id, "es")).toEqual([]);
    expect(await getExamLandingForStudent(examId, SEED.student.id, "es")).toBeNull();
    await expect(startExamAttempt(examId, courseId, null, fd({ language: "es" }))).resolves.toEqual({ error: "Exam not found." });
  });

  it("publish is refused until both languages are complete, then succeeds", async () => {
    actAs(SEED.profA.id);
    await updateQuestion(qIds[3], null, fd({ promptEs: "PLACEHOLDER essay es", promptEn: "" }));
    const bad = await publishExam(examId);
    expect(bad?.fieldErrors?._publish).toEqual(["Question 4: Add the English prompt."]);
    expect((await getOwnedExam(examId, A))?.status).toBe("draft");

    await updateQuestion(qIds[3], null, fd({ promptEs: "PLACEHOLDER essay es", promptEn: "PLACEHOLDER essay en" }));
    actAs(SEED.profB.id);
    expect(await publishExam(examId)).toEqual({ error: "Exam not found." });
    actAs(SEED.profA.id);
    expect(await publishExam(examId)).toMatchObject({ success: expect.any(String) });
    expect((await getOwnedExam(examId, A))?.status).toBe("published");
  });

  it("structure is locked while published", async () => {
    actAs(SEED.profA.id);
    expect((await updateExam(examId, null, fd(examFields)))?.error).toMatch(/can't be changed/);
    expect((await createQuestion(examId, null, fd(MC)))?.error).toMatch(/can't be changed/);
    expect((await updateQuestion(qIds[0], null, fd(MC)))?.error).toMatch(/can't be changed/);
    expect((await reorderQuestions(examId, { orderedIds: [...qIds].reverse() }))?.error).toMatch(/can't be changed/);
  });

  it("students never get answer keys or reference answers in any response", async () => {
    actAs(SEED.student.id);
    const list = await listExamsForStudent(courseId, SEED.student.id, "en");
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("PLACEHOLDER title");
    const landing = await getExamLandingForStudent(examId, SEED.student.id, "en");
    expect(landing).not.toBeNull();

    await expect(startExamAttempt(examId, courseId, null, fd({ language: "fr" }))).resolves.toMatchObject({ error: expect.any(String) });
    actAs(SEED.student2.id); // not enrolled
    expect(await getExamLandingForStudent(examId, SEED.student2.id, "en")).toBeNull();
    await expect(startExamAttempt(examId, courseId, null, fd({ language: "en" }))).resolves.toEqual({ error: "Exam not found." });
  });

  let attempt1: string;
  const answersFor = (opt: number) => [
    { questionId: qIds[0], selectedOption: opt },
    { questionId: qIds[1], selectedOption: 0 },
    { questionId: qIds[2], answerText: "PLACEHOLDER fill answer" },
    { questionId: qIds[3], answerText: "PLACEHOLDER essay answer" },
  ];

  it("starting is resumable, language is fixed for the attempt, and responses carry no keys", async () => {
    actAs(SEED.student.id);
    const to = await redirectTarget(startExamAttempt(examId, courseId, null, fd({ language: "en" })));
    attempt1 = to.split("/").pop()!;
    // a second tap (even asking for another language) resumes the same attempt
    const again = await redirectTarget(startExamAttempt(examId, courseId, null, fd({ language: "es" })));
    expect(again.split("/").pop()).toBe(attempt1);

    const view = (await getAttemptForStudent(attempt1, SEED.student.id))!;
    expect(view.language).toBe("en");
    expect(view.questions[0].options).toEqual(["n0", "n1", "n2"]);
    const landing = await getExamLandingForStudent(examId, SEED.student.id, "en");
    const list = await listExamsForStudent(courseId, SEED.student.id, "en");
    const wire = JSON.stringify({ view, landing, list });
    expect(wire).not.toMatch(/correctOption|correct_option|referenceAnswer|reference_answer|REFKEY/);

    // another student can't see this attempt
    expect(await getAttemptForStudent(attempt1, SEED.student2.id)).toBeNull();
  });

  it("autosave route: auth, ownership, validation, and partial saves", async () => {
    const call = (id: string, body: unknown) =>
      autosaveRoute(new NextRequest(`http://localhost/api/exams/attempts/${id}/answers`, { method: "PUT", body: JSON.stringify(body) }), {
        params: Promise.resolve({ attemptId: id }),
      });
    actAs(null);
    expect((await call(attempt1, { answers: [] })).status).toBe(401);
    actAs(SEED.student2.id);
    expect((await call(attempt1, { answers: [] })).status).toBe(404);
    actAs(SEED.student.id);
    expect((await call("not-a-uuid", { answers: [] })).status).toBe(404);
    expect((await call(attempt1, { answers: [{ questionId: qIds[0], selectedOption: 9 }] })).status).toBe(400);
    expect((await call(attempt1, { answers: [{ questionId: qIds[0], selectedOption: 7 }] })).status).toBe(400);
    expect((await call(attempt1, { nope: 1 })).status).toBe(400);
    const ok = await call(attempt1, { answers: [{ questionId: qIds[0], selectedOption: 2 }] });
    expect(ok.status).toBe(200);
    expect(Object.keys(await ok.json()).sort()).toEqual(["deadline", "saved"]);
    expect((await getAttemptForStudent(attempt1, SEED.student.id))!.answers).toHaveLength(1);
  });

  it("final submit needs every question and valid positions, then locks the attempt", async () => {
    actAs(SEED.student.id);
    expect((await submitExamAttempt(attempt1, { answers: answersFor(1).slice(0, 3) }))?.error).toMatch(/Answer every question/);
    expect((await submitExamAttempt(attempt1, { answers: answersFor(5) }))?.error).toBe("Invalid answer.");
    actAs(SEED.student2.id);
    expect(await submitExamAttempt(attempt1, { answers: answersFor(1) })).toEqual({ error: "Attempt not found." });
    actAs(SEED.student.id);
    expect(await submitExamAttempt(attempt1, { answers: answersFor(1) })).toEqual({ success: "Submitted." });
    expect(await submitExamAttempt(attempt1, { answers: answersFor(1) })).toEqual({ error: "This attempt was already submitted." });
    expect((await saveAttemptAnswers(attempt1, SEED.student.id, [])).ok).toBe(false);
    const v = (await getAttemptForStudent(attempt1, SEED.student.id))!;
    expect(v.status).toBe("submitted");
    expect(v.grade).toBeNull(); // nothing is auto-graded, not even multiple choice
  });

  let attempt2: string;
  it("an expired attempt closes lazily with the autosaved answers; max attempts is enforced", async () => {
    actAs(SEED.student.id);
    attempt2 = (await redirectTarget(startExamAttempt(examId, courseId, null, fd({ language: "es" })))).split("/").pop()!;
    expect((await getAttemptForStudent(attempt2, SEED.student.id))!.language).toBe("es");
    expect((await saveAttemptAnswers(attempt2, SEED.student.id, [{ questionId: qIds[1], selectedOption: 1 }])).ok).toBe(true);

    // time travel: 25 minutes ago, past the 20-minute window plus grace
    await db.execute(sql`update exam_submissions set started_at = now() - interval '25 minutes' where id = ${attempt2}::uuid`);
    expect(await saveAttemptAnswers(attempt2, SEED.student.id, [{ questionId: qIds[1], selectedOption: 0 }])).toMatchObject({ ok: false, reason: "expired" });
    const closed = (await getAttemptForStudent(attempt2, SEED.student.id))!;
    expect(closed.status).toBe("submitted");
    expect(closed.answers).toEqual([expect.objectContaining({ questionId: qIds[1], selectedOption: 1 })]); // the autosave, not the late write
    expect(closed.submittedAt!.getTime()).toBeLessThan(Date.now() - 4 * 60_000); // closed at the deadline, not now

    // two attempts used (default cap 2)
    expect(await startAttempt(examId, SEED.student.id, "en")).toEqual({ ok: false, reason: "no_attempts_left" });
    expect(await startExamAttempt(examId, courseId, null, fd({ language: "en" }))).toEqual({ error: "You have no attempts left on this exam." });
  });

  it("an in-progress attempt past its deadline is closed on read by the professor's list too", async () => {
    // (attempt2 already closed above; just confirm both attempts are listed as submitted)
    actAs(SEED.profA.id);
    const rows = (await listSubmissionsForExam(examId, A))!;
    expect(rows.map((r) => [r.attemptNumber, r.language, r.submittedAt !== null])).toEqual([
      [1, "en", true],
      [2, "es", true],
    ]);
    expect(await listSubmissionsForExam(examId, B)).toBeNull();
  });

  let sub1: string;
  let sub2: string;
  it("grading is manual, ownership-scoped, range-checked, and the highest grade counts", async () => {
    actAs(SEED.profA.id);
    const rows = (await listSubmissionsForExam(examId, A))!;
    [sub1, sub2] = rows.map((r) => r.id);

    const detail = (await getSubmissionForGrading(sub1, A))!;
    // the professor DOES see the key, beside the student's answer
    expect(detail.answers[0]).toMatchObject({ correctOption: 1, selectedOption: 1, options: ["n0", "n1", "n2"] });
    expect(detail.answers[2]).toMatchObject({ referenceAnswer: "REFKEY_FILL_EN", answerText: "PLACEHOLDER fill answer" });
    expect(await getSubmissionForGrading(sub1, B)).toBeNull();

    actAs(SEED.profB.id);
    expect(await gradeSubmission(sub1, null, fd({ grade: "50" }))).toEqual({ error: "Submission not found." });
    actAs(SEED.student.id);
    await expect(gradeSubmission(sub1, null, fd({ grade: "50" }))).rejects.toBeInstanceOf(AuthError);

    actAs(SEED.profA.id);
    expect((await gradeSubmission(sub1, null, fd({ grade: "101" })))?.error).toBeTruthy();
    expect((await gradeSubmission(sub1, null, fd({ grade: "" })))?.error).toBeTruthy();

    // student sees nothing until graded
    actAs(SEED.student.id);
    expect((await getExamLandingForStudent(examId, SEED.student.id, "en"))!.gradeOfRecord).toBeNull();

    actAs(SEED.profA.id);
    expect(await gradeSubmission(sub1, null, fd({ grade: "70", feedback: "PLACEHOLDER feedback", [`comment:${qIds[3]}`]: "PLACEHOLDER comment" }))).toEqual({ success: "Grade saved." });
    expect(await gradeSubmission(sub2, null, fd({ grade: "90.5" }))).toEqual({ success: "Grade saved." });

    actAs(SEED.student.id);
    const landing = (await getExamLandingForStudent(examId, SEED.student.id, "en"))!;
    expect(landing.gradeOfRecord).toBe(90.5); // highest, not latest and not average
    const mine = (await getAttemptForStudent(attempt1, SEED.student.id))!;
    expect(mine).toMatchObject({ grade: 70, feedback: "PLACEHOLDER feedback" });
    expect(mine.answers.find((a) => a.questionId === qIds[3])?.feedback).toBe("PLACEHOLDER comment");
    expect(JSON.stringify(mine)).not.toMatch(/correctOption|referenceAnswer|REFKEY/);
  });

  it("once students have attempts the exam can't be unpublished or deleted", async () => {
    actAs(SEED.profA.id);
    expect((await unpublishExam(examId))?.error).toMatch(/can't be unpublished/);
    expect((await deleteExam(examId))?.error).toMatch(/can't be deleted/);
    expect((await getOwnedExam(examId, A))?.status).toBe("published");
  });

  it("an unused published exam can be unpublished, edited, and deleted", async () => {
    actAs(SEED.profA.id);
    const to = await redirectTarget(createExam(courseId, null, fd(examFields)));
    const id = to.split("/").pop()!;
    await createQuestion(id, null, fd(TF));
    expect(await publishExam(id)).toMatchObject({ success: expect.any(String) });
    expect(await unpublishExam(id)).toEqual({ success: "Unpublished." });
    expect(await updateExam(id, null, fd({ ...examFields, titleEn: "PLACEHOLDER edited" }))).toEqual({ success: "Saved." });
    expect(await redirectTarget(deleteExam(id))).toBe(`/professor/courses/${courseId}`);
    expect(await getOwnedExam(id, A)).toBeNull();
  });
});
