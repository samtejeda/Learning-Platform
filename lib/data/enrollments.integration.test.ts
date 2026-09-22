import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs } from "@/test/setup-integration";
import { createAuthUser, deleteAuthUser, resetSeedData, SEED, seedUsers } from "@/test/seed";
import { insertCourse, getCourseForProfessor, getCourseForStudent, listEnrolledCourses } from "@/lib/data/courses";
import { inviteStudent, removeStudent, revokeInvitation } from "@/lib/enrollments/actions";
import { AuthError } from "@/lib/auth/session";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const NEWCOMER = { id: "a0000000-0000-4000-8000-0000000000aa", email: "newcomer@example.test", role: "student" };
const A = { id: SEED.profA.id, role: "professor" as const };

describe("enrollment invitations", () => {
  let courseId: string;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    await deleteAuthUser(NEWCOMER.id);
    ({ id: courseId } = await insertCourse({ title: "Invite test", description: null, professorId: SEED.profA.id }));
  });
  afterAll(async () => {
    await deleteAuthUser(NEWCOMER.id);
    await resetSeedData();
  });

  it("students cannot invite; other professors get 'not found'", async () => {
    actAs(SEED.student.id);
    await expect(inviteStudent(courseId, null, form({ email: SEED.student2.email }))).rejects.toBeInstanceOf(AuthError);
    actAs(SEED.profB.id);
    const state = await inviteStudent(courseId, null, form({ email: SEED.student2.email }));
    expect(state?.error).toBe("Course not found.");
    expect((await getCourseForProfessor(courseId, A))?.roster.enrolled).toHaveLength(0);
  });

  it("rejects a bad email before any DB write", async () => {
    actAs(SEED.profA.id);
    const state = await inviteStudent(courseId, null, form({ email: "not-an-email" }));
    expect(state?.fieldErrors?.email).toBeTruthy();
  });

  it("an existing account is enrolled immediately (email is normalised)", async () => {
    actAs(SEED.profA.id);
    const state = await inviteStudent(courseId, null, form({ email: "  STUDENT-1@Example.test " }));
    expect(state?.success).toMatch(/now enrolled/);
    const roster = (await getCourseForProfessor(courseId, A))!.roster;
    expect(roster.enrolled.map((s) => s.studentId)).toEqual([SEED.student.id]);
    expect(roster.invited).toEqual([]);
    expect(await listEnrolledCourses(SEED.student.id)).toMatchObject([{ id: courseId }]);
    expect(await getCourseForStudent(courseId, SEED.student.id)).toMatchObject({ title: "Invite test" });
  });

  it("inviting again is idempotent", async () => {
    actAs(SEED.profA.id);
    const state = await inviteStudent(courseId, null, form({ email: SEED.student.email }));
    expect(state?.success).toMatch(/already/);
    expect((await getCourseForProfessor(courseId, A))!.roster.enrolled).toHaveLength(1);
  });

  it("an unknown email is recorded as invited, then enrolled by the trigger on signup", async () => {
    actAs(SEED.profA.id);
    const state = await inviteStudent(courseId, null, form({ email: NEWCOMER.email }));
    expect(state?.success).toMatch(/invited/);
    let roster = (await getCourseForProfessor(courseId, A))!.roster;
    expect(roster.invited.map((i) => i.email)).toEqual([NEWCOMER.email]);

    // Simulate the sign-up: auth.users insert → 0003 trigger creates
    // public.users → 0006 trigger activates the invitation.
    await createAuthUser(NEWCOMER);
    roster = (await getCourseForProfessor(courseId, A))!.roster;
    expect(roster.invited).toEqual([]);
    expect(roster.enrolled.map((s) => s.studentId).sort()).toEqual([SEED.student.id, NEWCOMER.id].sort());
    expect(await getCourseForStudent(courseId, NEWCOMER.id)).not.toBeNull();
  });

  it("removing a student unenrolls them and lets them be re-invited", async () => {
    actAs(SEED.profA.id);
    // B can't remove from A's course.
    actAs(SEED.profB.id);
    expect((await removeStudent(courseId, null, form({ studentId: NEWCOMER.id })))?.error).toBe("Course not found.");

    actAs(SEED.profA.id);
    expect((await removeStudent(courseId, null, form({ studentId: NEWCOMER.id })))?.success).toMatch(/removed/);
    expect(await getCourseForStudent(courseId, NEWCOMER.id)).toBeNull();
    expect((await removeStudent(courseId, null, form({ studentId: NEWCOMER.id })))?.error).toBe("Student not found.");
    // Re-invite works because the accepted invitation was cleared too.
    expect((await inviteStudent(courseId, null, form({ email: NEWCOMER.email })))?.success).toMatch(/now enrolled/);
  });

  it("a pending invitation can be withdrawn only by the owner", async () => {
    actAs(SEED.profA.id);
    await inviteStudent(courseId, null, form({ email: "pending@example.test" }));
    const inv = (await getCourseForProfessor(courseId, A))!.roster.invited.find((i) => i.email === "pending@example.test")!;
    actAs(SEED.profB.id);
    expect((await revokeInvitation(courseId, null, form({ invitationId: inv.id })))?.error).toBe("Course not found.");
    actAs(SEED.profA.id);
    expect((await revokeInvitation(courseId, null, form({ invitationId: inv.id })))?.success).toMatch(/withdrawn/);
    expect((await getCourseForProfessor(courseId, A))!.roster.invited.some((i) => i.id === inv.id)).toBe(false);
  });

  it("rate limit trips after the per-user allowance", async () => {
    actAs(SEED.profB.id);
    const own = await insertCourse({ title: "B's", description: null, professorId: SEED.profB.id });
    // Exhaust B's per-user bucket directly (same key the action uses), then
    // the very next invite must be refused before any roster write.
    const policy = RATE_LIMITS.invite.perIdentifier;
    for (let i = 0; i < policy.limit; i++) {
      await checkRateLimit({ scope: "invite", kind: "id", subject: SEED.profB.id, window: policy });
    }
    const s = await inviteStudent(own.id, null, form({ email: "bulk@example.test" }));
    expect(s?.error).toMatch(/too many/i);
    expect((await getCourseForProfessor(own.id, { id: SEED.profB.id, role: "professor" }))!.roster.invited).toEqual([]);
  }, 90_000);
});
