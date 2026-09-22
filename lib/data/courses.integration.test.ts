import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actAs, RedirectSignal, redirects } from "@/test/setup-integration";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { createCourse, updateCourse } from "@/lib/courses/actions";
import {
  findOwnedCourse,
  getCourseForProfessor,
  getCourseForStudent,
  listTaughtCourses,
} from "@/lib/data/courses";
import { AuthError } from "@/lib/auth/session";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.to;
    throw e;
  }
  throw new Error("expected a redirect");
}

describe("courses: create/update with ownership", () => {
  let courseId: string;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
  });
  afterAll(async () => {
    await resetSeedData();
  });

  it("a student cannot create a course (server-side role check)", async () => {
    actAs(SEED.student.id);
    await expect(createCourse(null, form({ title: "Nope" }))).rejects.toBeInstanceOf(AuthError);
  });

  it("signed out cannot create a course", async () => {
    actAs(null);
    await expect(createCourse(null, form({ title: "Nope" }))).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects invalid input before touching the DB", async () => {
    actAs(SEED.profA.id);
    const state = await createCourse(null, form({ title: "   ", description: "x" }));
    expect(state?.fieldErrors?.title?.[0]).toMatch(/required/i);
    expect(await listTaughtCourses(SEED.profA.id)).toHaveLength(0);
  });

  it("professor A creates a course owned by A regardless of form contents", async () => {
    actAs(SEED.profA.id);
    const to = await expectRedirect(
      createCourse(null, form({ title: "  Romans  ", description: "", professorId: SEED.profB.id })),
    );
    expect(to).toMatch(/^\/professor\/courses\/[0-9a-f-]{36}$/);
    courseId = to.split("/").pop()!;
    const mine = await listTaughtCourses(SEED.profA.id);
    expect(mine).toEqual([{ id: courseId, title: "Romans", description: null }]);
    expect(await listTaughtCourses(SEED.profB.id)).toHaveLength(0);
  });

  it("ownership: B and a student see null; A and admin see the course", async () => {
    expect(await findOwnedCourse(courseId, { id: SEED.profB.id, role: "professor" })).toBeNull();
    expect(await findOwnedCourse(courseId, { id: SEED.student.id, role: "student" })).toBeNull();
    expect(await findOwnedCourse(courseId, { id: SEED.profA.id, role: "professor" })).toMatchObject({ id: courseId });
    expect(await findOwnedCourse(courseId, { id: SEED.admin.id, role: "admin" })).toMatchObject({ id: courseId });
    expect(await getCourseForProfessor(courseId, { id: SEED.profB.id, role: "professor" })).toBeNull();
    expect(await getCourseForStudent(courseId, SEED.student.id)).toBeNull(); // not enrolled
  });

  it("professor B cannot update A's course, even with a valid id", async () => {
    actAs(SEED.profB.id);
    const state = await updateCourse(courseId, null, form({ title: "Hijacked" }));
    expect(state?.error).toBe("Course not found.");
    const course = await getCourseForProfessor(courseId, { id: SEED.profA.id, role: "professor" });
    expect(course?.title).toBe("Romans");
  });

  it("a malformed bound id is rejected without a query", async () => {
    actAs(SEED.profA.id);
    const state = await updateCourse("not-a-uuid", null, form({ title: "X" }));
    expect(state?.error).toBe("Course not found.");
  });

  it("professor A updates their own course", async () => {
    actAs(SEED.profA.id);
    redirects.length = 0;
    const to = await expectRedirect(
      updateCourse(courseId, null, form({ title: "Romans (rev)", description: "Paul's letter" })),
    );
    expect(to).toBe(`/professor/courses/${courseId}`);
    const course = await getCourseForProfessor(courseId, { id: SEED.profA.id, role: "professor" });
    expect(course).toMatchObject({ title: "Romans (rev)", description: "Paul's letter", lectures: [] });
    expect(course?.roster).toEqual({ enrolled: [], invited: [] });
  });

  it("admin can update any course", async () => {
    actAs(SEED.admin.id);
    const to = await expectRedirect(updateCourse(courseId, null, form({ title: "Romans (admin)" })));
    expect(to).toBe(`/professor/courses/${courseId}`);
  });
});
