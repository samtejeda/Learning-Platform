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
import { getOwnedExam, listExamsForProfessor, getSubmissionForGrading, listSubmissionsForExam } from "@/lib/data/exams";
import {
  createExam,
  createQuestion,
  deleteExam,
  deleteQuestion,
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

const MC = { type: "multiple_choice", promptEs: "PLACEHOLDER mc es", promptEn: "PLACEHOLDER mc en", optionsEs: "e0\ne1\ne2", optionsEn: "n0\nn1\nn2", correctOption: "1", points: "2" };
const TF = { type: "true_false", promptEs: "PLACEHOLDER tf es", promptEn: "PLACEHOLDER tf en", correctOption: "0" };
const FILL = { type: "fill_in_the_blank", promptEs: "PLACEHOLDER fill es {{blank}} mid {{blank}}", promptEn: "PLACEHOLDER fill en {{blank}} mid {{blank}}", referenceAnswerEs: "REFKEY_FILL_ES", referenceAnswerEn: "REFKEY_FILL_EN", points: "3" };
const ESSAY = { type: "short_essay", promptEs: "PLACEHOLDER essay es", promptEn: "PLACEHOLDER essay en", referenceAnswerEs: "REFKEY_ESSAY_ES", referenceAnswerEn: "REFKEY_ESSAY_EN", points: "4" };

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
    expect(exam.questions[0]).toMatchObject({ optionsEs: ["e0", "e1", "e2"], correctOption: 1, points: 2 });
    expect(exam.questions.map((q) => q.points)).toEqual([2, 1, 3, 4]);
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

  it("a published exam with no attempts stays editable (incl. add, reorder, delete, option changes)", async () => {
    actAs(SEED.profB.id);
    expect(await updateExam(examId, null, fd(examFields))).toEqual({ error: "Exam not found." });
    expect(await updateQuestion(qIds[0], null, fd(MC))).toEqual({ error: "Question not found." });
    expect(await deleteQuestion(qIds[0])).toEqual({ error: "Question not found." });
    expect(await reorderQuestions(examId, { orderedIds: [...qIds] })).toEqual({ error: "Exam not found." });

    actAs(SEED.profA.id);
    expect(await updateExam(examId, null, fd({ ...examFields, titleEn: "PLACEHOLDER title" }))).toEqual({ success: "Saved." });
    // add a 5th question, change option count, reorder, then delete it again
    expect(await createQuestion(examId, null, fd(ESSAY))).toEqual({ success: "Question added." });
    const extra = (await getOwnedExam(examId, A))!.questions[4].id;
    expect(await updateQuestion(qIds[0], null, fd({ ...MC, optionsEs: "e0\ne1", optionsEn: "n0\nn1", correctOption: "0" }))).toEqual({ success: "Saved." });
    expect(await updateQuestion(qIds[0], null, fd(MC))).toEqual({ success: "Saved." });
    expect(await reorderQuestions(examId, { orderedIds: [extra, ...qIds] })).toEqual({ success: "Order saved." });
    expect(await reorderQuestions(examId, { orderedIds: [...qIds, extra] })).toEqual({ success: "Order saved." });
    expect(await deleteQuestion(extra)).toEqual({ success: "Question deleted." });
  });

  it("option lines and the blank marker are validated, never silently changed (create + update, cross-professor)", async () => {
    actAs(SEED.profA.id);
    const to = await redirectTarget(createExam(courseId, null, fd(examFields)));
    const id = to.split("/").pop()!;
    const list = async () => (await getOwnedExam(id, A))!.questions;
    // an empty line in the middle is refused, in either language (it would shift the key)
    expect((await createQuestion(id, null, fd({ ...MC, optionsEs: "e0\n\ne1\ne2" })))?.error).toMatch(/empty line between them/);
    expect((await createQuestion(id, null, fd({ ...MC, optionsEn: "\nn0\nn1\nn2" })))?.error).toMatch(/empty line between them/);
    // the two languages must list the same number of options
    expect((await createQuestion(id, null, fd({ ...MC, optionsEn: "n0\nn1" })))?.error).toMatch(/same number of options/);
    expect(await list()).toHaveLength(0);
    // trailing newline is fine; positions and key are exactly what was typed
    expect(await createQuestion(id, null, fd({ ...MC, optionsEs: "e0\ne1\ne2\n", correctOption: "2" }))).toEqual({ success: "Question added." });
    const [q] = await list();
    expect(q).toMatchObject({ optionsEs: ["e0", "e1", "e2"], optionsEn: ["n0", "n1", "n2"], correctOption: 2 });
    // update: same refusals, nothing stored changes
    expect((await updateQuestion(q.id, null, fd({ ...MC, optionsEs: "e0\n\ne1\ne2", correctOption: "2" })))?.error).toMatch(/empty line between them/);
    expect((await updateQuestion(q.id, null, fd({ ...MC, optionsEn: "n0\nn1\nn2\nn3", correctOption: "2" })))?.error).toMatch(/same number of options/);
    expect((await list())[0]).toMatchObject({ optionsEs: ["e0", "e1", "e2"], optionsEn: ["n0", "n1", "n2"], correctOption: 2 });
    actAs(SEED.profB.id);
    expect(await updateQuestion(q.id, null, fd({ ...MC, optionsEs: "x0\nx1\nx2", optionsEn: "y0\ny1\ny2", correctOption: "0" }))).toEqual({ error: "Question not found." });
    actAs(SEED.profA.id);
    expect((await list())[0]).toMatchObject({ optionsEs: ["e0", "e1", "e2"], correctOption: 2 });
    // the blank marker: refused in non-fill prompts (create and update, either language), accepted in fill
    for (const t of [MC, TF, ESSAY]) {
      expect((await createQuestion(id, null, fd({ ...t, promptEs: "PLACEHOLDER {{blank}}" })))?.error).toMatch(/only be used in fill-in-the-blank/);
      expect((await createQuestion(id, null, fd({ ...t, promptEn: "PLACEHOLDER {{blank}}" })))?.error).toMatch(/only be used in fill-in-the-blank/);
    }
    expect((await updateQuestion(q.id, null, fd({ ...MC, optionsEs: "e0\ne1\ne2", promptEs: "x {{blank}}", correctOption: "2" })))?.error).toMatch(/only be used in fill-in-the-blank/);
    expect(await createQuestion(id, null, fd(FILL))).toEqual({ success: "Question added." });
    expect((await list())[1].promptEs).toContain("{{blank}}");
    actAs(SEED.profB.id);
    expect(await createQuestion(id, null, fd(FILL))).toEqual({ error: "Exam not found." });
    actAs(SEED.profA.id);
    expect(await redirectTarget(deleteExam(id))).toBe(`/professor/courses/${courseId}`);
  });

  it("auto-scored questions can't be saved or published without a correct answer; points are bounded", async () => {
    actAs(SEED.profA.id);
    const to = await redirectTarget(createExam(courseId, null, fd(examFields)));
    const id = to.split("/").pop()!;
    const { correctOption: _k, ...mcNoKey } = MC;
    const { correctOption: _t, ...tfNoKey } = TF;
    expect((await createQuestion(id, null, fd(mcNoKey)))?.error).toMatch(/Mark the correct answer/);
    expect((await createQuestion(id, null, fd(tfNoKey)))?.error).toMatch(/true or false/);
    expect((await createQuestion(id, null, fd({ ...MC, correctOption: "3" })))?.error).toMatch(/one of the options/);
    expect((await createQuestion(id, null, fd({ ...ESSAY, points: "0" })))?.error).toBeTruthy();
    expect((await createQuestion(id, null, fd({ ...ESSAY, points: "101" })))?.error).toBeTruthy();
    expect((await createQuestion(id, null, fd({ ...ESSAY, points: "1.5" })))?.error).toBeTruthy();
    expect((await getOwnedExam(id, A))!.questions).toHaveLength(0);
    // a legacy draft row with no key (from before keys were required) is still refused at publish
    await createQuestion(id, null, fd(TF));
    await db.execute(sql`update exam_questions set correct_option = null where exam_id = ${id}::uuid`);
    expect((await publishExam(id))?.fieldErrors?._publish).toEqual(["Question 1: Mark whether the key is true or false."]);
    expect((await updateQuestion((await getOwnedExam(id, A))!.questions[0].id, null, fd({ promptEs: "PLACEHOLDER tf es" })))?.error).toBeTruthy(); // saving without a key is refused too
    actAs(SEED.profB.id);
    expect(await createQuestion(id, null, fd(TF))).toEqual({ error: "Exam not found." });
    actAs(SEED.profA.id);
    expect(await redirectTarget(deleteExam(id))).toBe(`/professor/courses/${courseId}`);
  });

  it("fill in the blank: es and en need the same number of blanks, to publish and on every edit", async () => {
    actAs(SEED.profA.id);
    const to = await redirectTarget(createExam(courseId, null, fd(examFields)));
    const id = to.split("/").pop()!;
    const mismatch = { ...FILL, promptEn: "PLACEHOLDER fill en {{blank}}" };
    expect(await createQuestion(id, null, fd(mismatch))).toEqual({ success: "Question added." }); // drafts may be incomplete
    expect((await publishExam(id))?.fieldErrors?._publish).toEqual(["Question 1: Spanish and English prompts must have the same number of blanks."]);
    const qid = (await getOwnedExam(id, A))!.questions[0].id;
    expect(await updateQuestion(qid, null, fd(FILL))).toEqual({ success: "Saved." });
    expect(await publishExam(id)).toMatchObject({ success: expect.any(String) });
    // published: an edit that unbalances the blanks is rejected and rolled back
    expect((await updateQuestion(qid, null, fd(mismatch)))?.error).toMatch(/Nothing was saved.*same number of blanks/);
    expect((await getOwnedExam(id, A))!.questions[0].promptEn).toBe(FILL.promptEn);
    expect(await updateQuestion(qid, null, fd({ ...FILL, promptEs: "PLACEHOLDER only {{blank}}", promptEn: "PLACEHOLDER only {{blank}}" }))).toEqual({ success: "Saved." });
    expect(await unpublishExam(id)).toEqual({ success: "Unpublished." });
    expect(await redirectTarget(deleteExam(id))).toBe(`/professor/courses/${courseId}`);
  });

  it("the publish gate re-runs on every edit to a published exam: rejected, rolled back, still published", async () => {
    actAs(SEED.profA.id);
    const before = (await getOwnedExam(examId, A))!;
    const bad = await updateQuestion(qIds[3], null, fd({ promptEs: "PLACEHOLDER essay es", promptEn: "" }));
    expect(bad?.error).toMatch(/Nothing was saved.*Question 4: Add the English prompt/);
    expect((await updateExam(examId, null, fd({ ...examFields, titleEs: "" })))?.error).toMatch(/Add a Spanish title/);
    // MC options that differ in count between languages, or a key out of range
    expect((await updateQuestion(qIds[0], null, fd({ ...MC, optionsEn: "n0\nn1" })))?.error).toMatch(/same number of options/);
    expect((await updateQuestion(qIds[0], null, fd({ ...MC, correctOption: "" })))?.error).toMatch(/Mark the correct answer/);
    const after = (await getOwnedExam(examId, A))!;
    expect(after.status).toBe("published");
    expect(after.questions).toEqual(before.questions);
    expect(after.titleEs).toBe(before.titleEs);
    // adding an incomplete question to a published exam is rejected too
    expect((await createQuestion(examId, null, fd({ type: "short_essay", promptEs: "PLACEHOLDER only es" })))?.error).toMatch(/Nothing was saved/);
    expect((await getOwnedExam(examId, A))!.questions).toHaveLength(4);
    // a draft may still be incomplete (gate applies to published only)
    const to = await redirectTarget(createExam(courseId, null, fd(examFields)));
    const draft = to.split("/").pop()!;
    expect(await createQuestion(draft, null, fd({ type: "short_essay", promptEs: "PLACEHOLDER only es" }))).toEqual({ success: "Question added." });
    expect(await redirectTarget(deleteExam(draft))).toBe(`/professor/courses/${courseId}`);
  });

  it("the professor's exam list counts questions and attempts per exam", async () => {
    actAs(SEED.profA.id);
    const row = (await listExamsForProfessor(courseId)).find((e) => e.id === examId);
    expect(row).toMatchObject({ questionCount: 4, attemptCount: 0, status: "published", revealKeysAfterAttempts: false });
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
    { questionId: qIds[2], blanks: ["b1", "b2"] },
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
    // mid-attempt: no result, no right/wrong flags, no revealed keys
    expect(view.result).toBeNull();
    expect(view.revealedAnswers).toBeNull();
    expect(view).toMatchObject({ revealKeysAfterAttempts: false, attemptsUsed: 1, maxAttempts: 2, attemptsLeft: 1 });
    expect(wire).not.toMatch(/perQuestion|"state"|"correct"|revealedAnswers":\[|"score":\{/);

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
    // a fill answer must have exactly one entry per blank in the prompt
    const wrongBlanks = answersFor(1).map((a) => (a.questionId === qIds[2] ? { questionId: qIds[2], blanks: ["only one"] } : a));
    expect((await submitExamAttempt(attempt1, { answers: wrongBlanks }))?.error).toBe("Invalid answer.");
    const emptyBlank = answersFor(1).map((a) => (a.questionId === qIds[2] ? { questionId: qIds[2], blanks: ["b1", " "] } : a));
    expect((await submitExamAttempt(attempt1, { answers: emptyBlank }))?.error).toMatch(/Answer every question/);
    actAs(SEED.student2.id);
    expect(await submitExamAttempt(attempt1, { answers: answersFor(1) })).toEqual({ error: "Attempt not found." });
    actAs(SEED.student.id);
    expect(await submitExamAttempt(attempt1, { answers: answersFor(1) })).toEqual({ success: "Submitted." });
    expect(await submitExamAttempt(attempt1, { answers: answersFor(1) })).toEqual({ error: "This attempt was already submitted." });
    expect((await saveAttemptAnswers(attempt1, SEED.student.id, [])).ok).toBe(false);
    const v = (await getAttemptForStudent(attempt1, SEED.student.id))!;
    expect(v.status).toBe("submitted");
    // right after submit: auto-scored right/wrong + provisional score, manual questions named as pending
    expect(v.result).toMatchObject({
      status: "pending", legacy: false, autoPoints: 3, autoMax: 3, pendingManualMax: 7, totalMax: 10, percent: null,
      pending: [{ questionId: qIds[2], number: 3 }, { questionId: qIds[3], number: 4 }],
    });
    expect(v.result!.perQuestion.map((p) => p.state)).toEqual(["correct", "correct", "awaiting", "awaiting"]);
    expect(v.grade).toBeNull();
    expect(v.revealedAnswers).toBeNull(); // default: right/wrong only, never the correct answer
    expect(v).toMatchObject({ revealKeysAfterAttempts: false, attemptsUsed: 1, maxAttempts: 2, attemptsLeft: 1 });
    expect(JSON.stringify(v)).not.toMatch(/correctOption|correct_option|referenceAnswer|reference_answer|REFKEY|revealedAnswers":\[/);
    expect(v.answers.find((a) => a.questionId === qIds[2])?.blankAnswers).toEqual(["b1", "b2"]);
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
  it("attempt 2 (closed with only a wrong auto answer) is final at once; attempt 1 is pending; the record ignores pending", async () => {
    actAs(SEED.student.id);
    const landing = (await getExamLandingForStudent(examId, SEED.student.id, "en"))!;
    expect(landing.attempts.map((a) => [a.attemptNumber, a.score?.status])).toEqual([[1, "pending"], [2, "final"]]);
    expect(landing.gradeOfRecord).toBe(0); // only attempt 2 is final (0 of 10)
    const closed = (await getAttemptForStudent(attempt2, SEED.student.id))!;
    expect(closed.result).toMatchObject({ status: "final", autoPoints: 0, totalPoints: 0, totalMax: 10, percent: 0 });
    expect(closed.result!.perQuestion.map((p) => p.state)).toEqual(["unanswered", "incorrect", "unanswered", "unanswered"]);
  });

  it("manual grading: points per manual question, bounds, ownership, pending becomes final, highest attempt counts", async () => {
    actAs(SEED.profA.id);
    const rows = (await listSubmissionsForExam(examId, A))!;
    [sub1, sub2] = rows.map((r) => r.id);
    expect(rows[0].score).toMatchObject({ status: "pending", autoPoints: 3, pendingCount: 2 });
    expect(rows[1].score).toMatchObject({ status: "final", totalPoints: 0 });

    const detail = (await getSubmissionForGrading(sub1, A))!;
    // the professor DOES see the key beside the student's answer, plus derived per-question results
    expect(detail.answers[0]).toMatchObject({ correctOption: 1, selectedOption: 1, options: ["n0", "n1", "n2"], state: "correct", pointsEarned: 2, points: 2 });
    expect(detail.answers[2]).toMatchObject({ referenceAnswer: "REFKEY_FILL_EN", blanks: ["b1", "b2"], state: "awaiting", points: 3, pointsAwarded: null });
    expect(detail.score).toMatchObject({ status: "pending", totalPoints: 3 });
    expect(await getSubmissionForGrading(sub1, B)).toBeNull();

    actAs(SEED.profB.id);
    expect(await gradeSubmission(sub1, null, fd({ [`points:${qIds[2]}`]: "1", [`points:${qIds[3]}`]: "1" }))).toEqual({ error: "Submission not found." });
    actAs(SEED.student.id);
    await expect(gradeSubmission(sub1, null, fd({ [`points:${qIds[2]}`]: "1" }))).rejects.toBeInstanceOf(AuthError);

    actAs(SEED.profA.id);
    const pts = (fill: string, essay: string) => ({ [`points:${qIds[2]}`]: fill, [`points:${qIds[3]}`]: essay });
    expect((await gradeSubmission(sub1, null, fd(pts("4", "1"))))?.error).toMatch(/more than the question's 3/); // above its weight
    expect((await gradeSubmission(sub1, null, fd(pts("1", "-1"))))?.error).toBeTruthy();
    expect((await gradeSubmission(sub1, null, fd(pts("1", "2.3"))))?.error).toBeTruthy(); // not a half step
    expect((await gradeSubmission(sub1, null, fd({ [`points:${qIds[2]}`]: "1" })))?.error).toMatch(/every question that needs grading/);
    expect((await gradeSubmission(sub1, null, fd(pts("", "1"))))?.error).toBeTruthy();
    // nothing was saved by the refused attempts: still pending
    expect((await getSubmissionForGrading(sub1, A))!.score.status).toBe("pending");
    // points for a multiple-choice question are ignored: it can't be graded by hand
    expect(await gradeSubmission(sub1, null, fd({ ...pts("3", "2.5"), [`points:${qIds[0]}`]: "0", feedback: "PLACEHOLDER feedback", [`comment:${qIds[3]}`]: "PLACEHOLDER comment" }))).toEqual({ success: "Grade saved." });
    const graded = (await getSubmissionForGrading(sub1, A))!;
    expect(graded.score).toMatchObject({ status: "final", totalPoints: 8.5, totalMax: 10, percent: 85, manualPoints: 5.5 });
    expect(graded.answers[0]).toMatchObject({ state: "correct", pointsEarned: 2 });

    actAs(SEED.student.id);
    const mine = (await getAttemptForStudent(attempt1, SEED.student.id))!;
    expect(mine.result).toMatchObject({ status: "final", totalPoints: 8.5, percent: 85, pending: [] });
    expect(mine.result!.perQuestion.map((p) => [p.state, p.points])).toEqual([["correct", 2], ["correct", 1], ["graded", 3], ["graded", 2.5]]);
    expect(mine).toMatchObject({ grade: 85, feedback: "PLACEHOLDER feedback" });
    expect(mine.answers.find((a) => a.questionId === qIds[3])?.feedback).toBe("PLACEHOLDER comment");
    expect(JSON.stringify(mine)).not.toMatch(/correctOption|referenceAnswer|REFKEY/);
    // highest FINAL attempt counts, not the latest (attempt 2 = 0) and not the average
    expect((await getExamLandingForStudent(examId, SEED.student.id, "en"))!.gradeOfRecord).toBe(85);
    expect((await listExamsForStudent(courseId, SEED.student.id, "en"))[0].gradeOfRecord).toBe(85);
    actAs(SEED.profA.id);
    expect((await listSubmissionsForExam(examId, A))!.map((r) => r.gradeOfRecord)).toEqual([85, 85]);
  });

  it("the correct answer reaches a student only when the exam's reveal setting is on and every attempt is used", async () => {
    const view = async () => (await getAttemptForStudent(attempt1, SEED.student.id))!;
    actAs(SEED.student.id);
    const off = await view();
    expect(off.revealedAnswers).toBeNull(); // default off, attempts used up
    expect(off).toMatchObject({ revealKeysAfterAttempts: false, attemptsUsed: 2, maxAttempts: 2, attemptsLeft: 0 });
    expect(JSON.stringify(off)).not.toMatch(/correctOption|correct_option|referenceAnswer|reference_answer|REFKEY|revealedAnswers":\[/);
    actAs(SEED.profA.id);
    const on = { ...examFields, revealKeysAfterAttempts: "on" };
    // reveal on, but a third attempt is still available: nothing revealed
    expect(await updateExam(examId, null, fd({ ...on, maxAttempts: "3" }))).toEqual({ success: "Saved." });
    actAs(SEED.student.id);
    const left = await view();
    expect(left.revealedAnswers).toBeNull();
    expect(left).toMatchObject({ revealKeysAfterAttempts: true, attemptsUsed: 2, maxAttempts: 3, attemptsLeft: 1 });
    expect(JSON.stringify(left)).not.toMatch(/correctOption|correct_option|referenceAnswer|reference_answer|REFKEY|revealedAnswers":\[/);
    actAs(SEED.profA.id);
    expect(await updateExam(examId, null, fd(on))).toEqual({ success: "Saved." });
    expect((await getOwnedExam(examId, A))!.revealKeysAfterAttempts).toBe(true);
    actAs(SEED.student.id);
    const revealed = await view();
    expect(revealed.revealedAnswers).toEqual([{ questionId: qIds[0], correct: 1 }, { questionId: qIds[1], correct: 0 }]);
    expect(revealed).toMatchObject({ revealKeysAfterAttempts: true, attemptsUsed: 2, maxAttempts: 2, attemptsLeft: 0 });
    expect(JSON.stringify(revealed)).not.toMatch(/correctOption|correct_option|referenceAnswer|reference_answer|REFKEY/); // guides never
    // another student can't use it, and off again hides it
    expect(await getAttemptForStudent(attempt1, SEED.student2.id)).toBeNull();
    actAs(SEED.profA.id);
    expect(await updateExam(examId, null, fd(examFields))).toEqual({ success: "Saved." });
    actAs(SEED.student.id);
    expect((await view()).revealedAnswers).toBeNull();
  });

  it("with attempts: wording, keys, details and limits stay editable", async () => {
    actAs(SEED.profA.id);
    expect(await updateQuestion(qIds[0], null, fd({ ...MC, promptEn: "PLACEHOLDER mc en fixed", optionsEn: "n0\nn1 fixed\nn2", correctOption: "2" }))).toEqual({ success: "Saved." });
    expect(await updateQuestion(qIds[1], null, fd({ ...TF, correctOption: "1" }))).toEqual({ success: "Saved." });
    expect(await updateQuestion(qIds[2], null, fd({ ...FILL, referenceAnswerEn: "REFKEY_FILL_EN2" }))).toEqual({ success: "Saved." });
    expect(await updateExam(examId, null, fd({ ...examFields, titleEn: "PLACEHOLDER title", maxAttempts: "3", durationMinutes: "30" }))).toEqual({ success: "Saved." });
    const exam = (await getOwnedExam(examId, A))!;
    expect(exam).toMatchObject({ maxAttempts: 3, durationMinutes: 30, attemptCount: 2 });
    expect(exam.questions[0]).toMatchObject({ correctOption: 2, optionsEn: ["n0", "n1 fixed", "n2"] });
    // the grading page shows the corrected key beside the unchanged stored answer
    const detail = (await getSubmissionForGrading(sub1, A))!;
    expect(detail.answers[0]).toMatchObject({ correctOption: 2, selectedOption: 1, state: "incorrect", pointsEarned: 0 });
    // correcting the keys re-scores the existing attempt (derived, never stored): 8.5 -> 5.5 -> 5.5 - 1
    expect(detail.score).toMatchObject({ autoPoints: 0, totalPoints: 5.5, percent: 55 });
    actAs(SEED.student.id);
    expect((await getAttemptForStudent(attempt1, SEED.student.id))!.result).toMatchObject({ autoPoints: 0, totalPoints: 5.5 });
    expect((await getExamLandingForStudent(examId, SEED.student.id, "en"))!.gradeOfRecord).toBe(55);
    actAs(SEED.profA.id);
    // the number of blanks can't change once answers exist; wording around them can
    expect(await updateQuestion(qIds[2], null, fd({ ...FILL, promptEs: "PLACEHOLDER fill es {{blank}}" }))).toMatchObject({ error: expect.stringMatching(/number of blanks/) });
    expect(await updateQuestion(qIds[2], null, fd({ ...FILL, promptEn: "PLACEHOLDER fixed {{blank}} mid {{blank}}" }))).toEqual({ success: "Saved." });
    expect(await updateQuestion(qIds[3], null, fd({ ...ESSAY, points: "5" }))).toEqual({ success: "Saved." }); // weight edits are allowed
    expect((await getSubmissionForGrading(sub1, A))!.score).toMatchObject({ totalMax: 11 });
    expect(await updateQuestion(qIds[3], null, fd(ESSAY))).toEqual({ success: "Saved." });
    // restore for later tests
    expect(await updateQuestion(qIds[0], null, fd(MC))).toEqual({ success: "Saved." });
    expect(await updateQuestion(qIds[1], null, fd(TF))).toEqual({ success: "Saved." });
    expect(await updateExam(examId, null, fd(examFields))).toEqual({ success: "Saved." });
  });

  it("with attempts: position-changing edits are blocked with a clear message", async () => {
    actAs(SEED.profA.id);
    const before = (await getOwnedExam(examId, A))!;
    expect(await deleteQuestion(qIds[3])).toMatchObject({ error: expect.stringMatching(/questions can't be deleted/) });
    expect(await reorderQuestions(examId, { orderedIds: [...qIds].reverse() })).toMatchObject({ error: expect.stringMatching(/can't be reordered/) });
    expect(await createQuestion(examId, null, fd(ESSAY))).toMatchObject({ error: expect.stringMatching(/questions can't be added/) });
    // add / remove an option (either language)
    expect(await updateQuestion(qIds[0], null, fd({ ...MC, optionsEs: "e0\ne1\ne2\ne3", optionsEn: "n0\nn1\nn2\nn3" }))).toMatchObject({ error: expect.stringMatching(/number of options/) });
    expect(await updateQuestion(qIds[0], null, fd({ ...MC, optionsEn: "n0\nn1" }))).toMatchObject({ error: expect.stringMatching(/number of options/) });
    // reorder options
    expect(await updateQuestion(qIds[0], null, fd({ ...MC, optionsEs: "e1\ne0\ne2", optionsEn: "n1\nn0\nn2" }))).toMatchObject({ error: expect.stringMatching(/order of options/) });
    const after = (await getOwnedExam(examId, A))!;
    expect(after.questions).toEqual(before.questions);
    // question type is immutable: a "type" field on an update is ignored
    expect(await updateQuestion(qIds[3], null, fd({ ...TF, type: "true_false" }))).toEqual({ success: "Saved." });
    expect((await getOwnedExam(examId, A))!.questions[3].type).toBe("short_essay");
    expect(await updateQuestion(qIds[3], null, fd(ESSAY))).toEqual({ success: "Saved." });
    // cross-professor still not found
    actAs(SEED.profB.id);
    expect(await deleteQuestion(qIds[3])).toEqual({ error: "Question not found." });
  });

  it("with attempts: the gate still applies, delete stays blocked, unpublish is allowed and reversible", async () => {
    actAs(SEED.profA.id);
    expect((await updateQuestion(qIds[3], null, fd({ ...ESSAY, promptEn: "" })))?.error).toMatch(/Nothing was saved/);
    expect((await deleteExam(examId))?.error).toMatch(/can't be deleted/);
    actAs(SEED.profB.id);
    expect(await unpublishExam(examId)).toEqual({ error: "Exam not found." });
    actAs(SEED.profA.id);
    expect(await unpublishExam(examId)).toEqual({ success: "Unpublished." });
    expect((await getOwnedExam(examId, A))!.attemptCount).toBe(2);
    // attempts rule keys on attempts, not on draft state
    expect(await deleteQuestion(qIds[3])).toMatchObject({ error: expect.stringMatching(/can't be deleted/) });
    expect(await publishExam(examId)).toMatchObject({ success: expect.any(String) });
  });

  it("student payloads still carry no keys after edits (JSON scan)", async () => {
    actAs(SEED.student.id);
    const view = (await getAttemptForStudent(attempt1, SEED.student.id))!;
    const landing = await getExamLandingForStudent(examId, SEED.student.id, "en");
    const list = await listExamsForStudent(courseId, SEED.student.id, "en");
    expect(JSON.stringify({ view, landing, list })).not.toMatch(/correctOption|correct_option|referenceAnswer|reference_answer|REFKEY/);
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
