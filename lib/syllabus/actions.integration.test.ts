import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs } from "@/test/setup-integration";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { insertCourse, getCourseForProfessor, getCourseForStudent, getSyllabusForViewer } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { finalizeSyllabusUpload, removeSyllabus, uploadSyllabus } from "@/lib/syllabus/actions";
import { AuthError } from "@/lib/auth/session";

// Storage is mocked: these tests prove the DB-side rules (ownership, the
// PDF-only gate, no-publish-step visibility). The real signed-URL round
// trip is covered by lib/storage/course-files.integration.test.ts.
const storage = vi.hoisted(() => ({
  objects: new Map<string, { sizeBytes: number; contentType: string | null }>(),
  removed: [] as string[],
}));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    createCourseFileUploadUrl: async () => ({ token: "test-token" }),
    getCourseFileInfo: async (path: string) => storage.objects.get(path) ?? null,
    removeCourseFileObjects: async (paths: string[]) => {
      storage.removed.push(...paths);
      paths.forEach((p) => storage.objects.delete(p));
    },
  };
});

const A = { id: SEED.profA.id, role: "professor" as const };

describe("syllabus: upload lifecycle with ownership (no publish step)", () => {
  let courseId: string;
  let path: string;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "Syllabus test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
  });
  afterAll(async () => {
    await resetSeedData();
  });

  it("students and other professors cannot upload a syllabus", async () => {
    actAs(SEED.student.id);
    await expect(uploadSyllabus(courseId, { contentType: "application/pdf", sizeBytes: 10 })).rejects.toBeInstanceOf(
      AuthError,
    );
    actAs(SEED.profB.id);
    const t = await uploadSyllabus(courseId, { contentType: "application/pdf", sizeBytes: 10 });
    expect(t).toEqual({ ok: false, error: "Course not found." });
  });

  it("rejects a non-PDF content type before issuing a token", async () => {
    actAs(SEED.profA.id);
    const t = await uploadSyllabus(courseId, { contentType: "image/png", sizeBytes: 10 });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.fieldErrors?.contentType).toBeTruthy();
  });

  it("issues a token for the course's fixed syllabus.pdf path", async () => {
    actAs(SEED.profA.id);
    const t = await uploadSyllabus(courseId, { contentType: "application/pdf", sizeBytes: 1234 });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    path = t.path;
    expect(t.bucket).toBe("course-files");
    expect(t.token).toBe("test-token");
    expect(path).toBe(`courses/${courseId}/syllabus.pdf`);
    // Nothing recorded on the course yet — finalize hasn't run.
    expect((await getCourseForProfessor(courseId, A))!.syllabusUploadedAt).toBeNull();
  });

  it("finalize checks the object server-side; wrong content is refused and removed", async () => {
    actAs(SEED.profA.id);
    expect((await finalizeSyllabusUpload(courseId))?.error).toMatch(/hasn't finished/);

    storage.objects.set(path, { sizeBytes: 5, contentType: "text/html" });
    expect((await finalizeSyllabusUpload(courseId))?.error).toMatch(/isn't a PDF/);
    expect(storage.removed).toContain(path);

    storage.objects.set(path, { sizeBytes: 1234, contentType: "application/pdf" });
    expect((await finalizeSyllabusUpload(courseId))?.success).toMatch(/uploaded/i);
  });

  it("uploading makes it visible to students immediately — no publish step", async () => {
    const professorView = await getCourseForProfessor(courseId, A);
    expect(professorView!.syllabusUploadedAt).not.toBeNull();

    const studentView = await getCourseForStudent(courseId, SEED.student.id);
    expect(studentView!.hasSyllabus).toBe(true);

    // Unenrolled student sees nothing at all (course itself is a 404 for them).
    expect(await getCourseForStudent(courseId, SEED.student2.id)).toBeNull();

    // The signed-URL viewer query: owner + enrolled student both resolve.
    expect(await getSyllabusForViewer(courseId, A)).toMatchObject({ storagePath: path });
    expect(await getSyllabusForViewer(courseId, { id: SEED.student.id, role: "student" })).toMatchObject({
      storagePath: path,
    });
    expect(await getSyllabusForViewer(courseId, { id: SEED.student2.id, role: "student" })).toBeNull();
    expect(await getSyllabusForViewer(courseId, { id: SEED.profB.id, role: "professor" })).toBeNull();
  });

  it("other professors cannot remove A's syllabus", async () => {
    actAs(SEED.profB.id);
    expect((await removeSyllabus(courseId))?.error).toBe("Course not found.");
    expect((await getCourseForProfessor(courseId, A))!.syllabusUploadedAt).not.toBeNull();
  });

  it("re-upload replaces it in place at the same fixed path", async () => {
    actAs(SEED.profA.id);
    const t = await uploadSyllabus(courseId, { contentType: "application/pdf", sizeBytes: 999 });
    expect(t.ok && t.path).toBe(path); // same deterministic path — upsert in place
  });

  it("remove clears the reference and deletes the object", async () => {
    actAs(SEED.profA.id);
    storage.removed.length = 0;
    expect((await removeSyllabus(courseId))?.success).toBe("Syllabus removed.");
    expect(storage.removed).toEqual([path]);
    expect((await getCourseForProfessor(courseId, A))!.syllabusUploadedAt).toBeNull();
    expect((await getCourseForStudent(courseId, SEED.student.id))!.hasSyllabus).toBe(false);
  });
});
