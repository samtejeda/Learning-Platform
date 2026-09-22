import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs } from "@/test/setup-integration";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { insertCourse, getCourseForProfessor, getCourseForStudent } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { getOwnedLecture } from "@/lib/data/lectures";
import {
  createLecture,
  deleteLecture,
  finalizeLectureUpload,
  publishLecture,
  reorderLectures,
  unpublishLecture,
} from "@/lib/lectures/actions";
import { AuthError } from "@/lib/auth/session";

// Storage is mocked: these tests prove the DB-side rules (ownership,
// lifecycle gates, ordering). The real signed-URL round trip needs
// SUPABASE_SERVICE_ROLE_KEY and is exercised manually / in e2e.
const storage = vi.hoisted(() => ({
  objects: new Map<string, { sizeBytes: number; contentType: string | null }>(),
  removed: [] as string[],
}));
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    createLectureUploadUrl: async () => ({ token: "test-token" }),
    getObjectInfo: async (path: string) => storage.objects.get(path) ?? null,
    removeObjects: async (paths: string[]) => {
      storage.removed.push(...paths);
      paths.forEach((p) => storage.objects.delete(p));
    },
  };
});

const A = { id: SEED.profA.id, role: "professor" as const };

describe("lectures: upload lifecycle with ownership", () => {
  let courseId: string;
  let lectureId: string;
  let path: string;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "Lecture test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
  });
  afterAll(async () => {
    await resetSeedData();
  });

  it("students and other professors cannot create lectures", async () => {
    actAs(SEED.student.id);
    await expect(createLecture(courseId, { title: "x", contentType: "video/mp4", sizeBytes: 10 })).rejects.toBeInstanceOf(AuthError);
    actAs(SEED.profB.id);
    const t = await createLecture(courseId, { title: "x", contentType: "video/mp4", sizeBytes: 10 });
    expect(t).toEqual({ ok: false, error: "Course not found." });
  });

  it("rejects a bad content type / size before creating anything", async () => {
    actAs(SEED.profA.id);
    const t = await createLecture(courseId, { title: "x", contentType: "application/x-sh", sizeBytes: 10 });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.fieldErrors?.contentType).toBeTruthy();
    expect((await getCourseForProfessor(courseId, A))!.lectures).toHaveLength(0);
  });

  it("creates a pending-upload row with a server-chosen path and a token", async () => {
    actAs(SEED.profA.id);
    const t = await createLecture(courseId, { title: "Intro", description: "", contentType: "video/mp4", sizeBytes: 1234 });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    lectureId = t.lectureId;
    path = t.path;
    expect(t.bucket).toBe("lectures");
    expect(t.token).toBe("test-token");
    expect(path).toBe(`courses/${courseId}/lectures/${lectureId}/video.mp4`);
    const lectures = (await getCourseForProfessor(courseId, A))!.lectures;
    expect(lectures).toMatchObject([{ id: lectureId, title: "Intro", status: "pending_upload", order: 0 }]);
    // Invisible to the enrolled student while pending.
    expect((await getCourseForStudent(courseId, SEED.student.id))!.lectures).toEqual([]);
  });

  it("cannot publish before the object exists; finalize checks the object server-side", async () => {
    actAs(SEED.profA.id);
    expect((await publishLecture(lectureId))?.error).toMatch(/upload a video/i);
    expect((await finalizeLectureUpload(lectureId, { durationSeconds: 120 }))?.error).toMatch(/hasn't finished/);

    // Wrong content at the path → refused and removed.
    storage.objects.set(path, { sizeBytes: 5, contentType: "text/html" });
    expect((await finalizeLectureUpload(lectureId, { durationSeconds: 120 }))?.error).toMatch(/supported video/);
    expect(storage.removed).toContain(path);

    storage.objects.set(path, { sizeBytes: 1234, contentType: "video/mp4" });
    expect((await finalizeLectureUpload(lectureId, { durationSeconds: 0 }))?.fieldErrors?.durationSeconds).toBeTruthy();
    expect((await finalizeLectureUpload(lectureId, { durationSeconds: 120 }))?.success).toMatch(/uploaded/i);
    expect((await getOwnedLecture(lectureId, A))).toMatchObject({ status: "draft", durationSeconds: 120 });
  });

  it("other professors cannot finalize/publish/delete; owner can publish, student then sees it", async () => {
    actAs(SEED.profB.id);
    expect((await publishLecture(lectureId))?.error).toBe("Lecture not found.");
    expect((await deleteLecture(lectureId))?.error).toBe("Lecture not found.");
    expect(await getOwnedLecture(lectureId, { id: SEED.profB.id, role: "professor" })).toBeNull();

    actAs(SEED.profA.id);
    expect((await publishLecture(lectureId))?.success).toBe("Published.");
    const visible = (await getCourseForStudent(courseId, SEED.student.id))!.lectures;
    expect(visible).toMatchObject([{ id: lectureId, title: "Intro", percentWatched: 0, completed: false }]);
    // Unenrolled student sees nothing at all.
    expect(await getCourseForStudent(courseId, SEED.student2.id)).toBeNull();

    expect((await unpublishLecture(lectureId))?.success).toBe("Unpublished.");
    expect((await getCourseForStudent(courseId, SEED.student.id))!.lectures).toEqual([]);
    await publishLecture(lectureId);
  });

  it("reorder must cover exactly the course's lectures and is owner-only", async () => {
    actAs(SEED.profA.id);
    const t2 = await createLecture(courseId, { title: "Second", contentType: "video/webm", sizeBytes: 10 });
    if (!t2.ok) throw new Error(t2.error);
    const before = (await getCourseForProfessor(courseId, A))!.lectures.map((l) => l.id);
    expect(before).toEqual([lectureId, t2.lectureId]);

    expect((await reorderLectures(courseId, { orderedIds: [t2.lectureId] }))?.error).toMatch(/changed/);
    expect((await reorderLectures(courseId, { orderedIds: [t2.lectureId, "33333333-3333-4333-8333-333333333333"] }))?.error).toMatch(/changed/);
    actAs(SEED.profB.id);
    expect((await reorderLectures(courseId, { orderedIds: [t2.lectureId, lectureId] }))?.error).toBe("Course not found.");
    actAs(SEED.profA.id);
    expect((await reorderLectures(courseId, { orderedIds: [t2.lectureId, lectureId] }))?.success).toBe("Order saved.");
    const after = (await getCourseForProfessor(courseId, A))!.lectures.map((l) => l.id);
    expect(after).toEqual([t2.lectureId, lectureId]);
  });

  it("delete removes the object and the row", async () => {
    actAs(SEED.profA.id);
    storage.removed.length = 0;
    expect((await deleteLecture(lectureId))?.success).toBe("Lecture deleted.");
    expect(storage.removed).toEqual([path]);
    expect(await getOwnedLecture(lectureId, A)).toBeNull();
    expect((await getCourseForStudent(courseId, SEED.student.id))!.lectures).toEqual([]);
  });
});
