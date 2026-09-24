import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs } from "@/test/setup-integration";
import { resetSeedData, SEED, seedUsers } from "@/test/seed";
import { insertCourse, getCourseForProfessor, getCourseForStudent } from "@/lib/data/courses";
import { inviteByEmail } from "@/lib/data/enrollments";
import { getOwnedMaterial, getMaterialForViewer } from "@/lib/data/course-materials";
import {
  createMaterial,
  deleteMaterial,
  finalizeMaterialUpload,
  publishMaterial,
  reorderMaterials,
  unpublishMaterial,
} from "@/lib/course-materials/actions";
import { AuthError } from "@/lib/auth/session";

// Storage is mocked: these tests prove the DB-side rules (ownership,
// lifecycle gates, ordering, kind branching). The real signed-URL round
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

describe("course materials: upload lifecycle with ownership (file kind)", () => {
  let courseId: string;
  let materialId: string;
  let path: string;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "Materials test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
  });
  afterAll(async () => {
    await resetSeedData();
  });

  it("students and other professors cannot create materials", async () => {
    actAs(SEED.student.id);
    await expect(
      createMaterial(courseId, { kind: "file", title: "x", contentType: "application/pdf", sizeBytes: 10 }),
    ).rejects.toBeInstanceOf(AuthError);
    actAs(SEED.profB.id);
    const t = await createMaterial(courseId, {
      kind: "file",
      title: "x",
      contentType: "application/pdf",
      sizeBytes: 10,
    });
    expect(t).toEqual({ ok: false, error: "Course not found." });
  });

  it("rejects a bad content type / size before creating anything", async () => {
    actAs(SEED.profA.id);
    const t = await createMaterial(courseId, {
      kind: "file",
      title: "x",
      contentType: "application/x-sh",
      sizeBytes: 10,
    });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.fieldErrors?.contentType).toBeTruthy();
    expect((await getCourseForProfessor(courseId, A))!.materials).toHaveLength(0);
  });

  it("creates a pending-upload row with a server-chosen path and a token", async () => {
    actAs(SEED.profA.id);
    const t = await createMaterial(courseId, {
      kind: "file",
      title: "Handout",
      description: "",
      contentType: "application/pdf",
      sizeBytes: 1234,
    });
    expect(t.ok).toBe(true);
    if (!t.ok || t.kind !== "file") return;
    materialId = t.materialId;
    path = t.path;
    expect(t.bucket).toBe("course-files");
    expect(t.token).toBe("test-token");
    expect(path).toBe(`courses/${courseId}/materials/${materialId}/file.pdf`);
    const materials = (await getCourseForProfessor(courseId, A))!.materials;
    expect(materials).toMatchObject([{ id: materialId, title: "Handout", kind: "file", status: "pending_upload", order: 0 }]);
    // Invisible to the enrolled student while pending.
    expect((await getCourseForStudent(courseId, SEED.student.id))!.materials).toEqual([]);
  });

  it("cannot publish before the object exists; finalize checks the object server-side", async () => {
    actAs(SEED.profA.id);
    expect((await publishMaterial(materialId))?.error).toMatch(/upload a file/i);
    expect((await finalizeMaterialUpload(materialId, {}))?.error).toMatch(/hasn't finished/);

    // Wrong content at the path → refused and removed.
    storage.objects.set(path, { sizeBytes: 5, contentType: "text/html" });
    expect((await finalizeMaterialUpload(materialId, {}))?.error).toMatch(/isn't supported/);
    expect(storage.removed).toContain(path);

    storage.objects.set(path, { sizeBytes: 1234, contentType: "application/pdf" });
    expect((await finalizeMaterialUpload(materialId, {}))?.success).toMatch(/uploaded/i);
    expect(await getOwnedMaterial(materialId, A)).toMatchObject({ status: "draft", mimeType: "application/pdf" });
  });

  it("other professors cannot finalize/publish/delete; owner can publish, student then sees it", async () => {
    actAs(SEED.profB.id);
    expect((await publishMaterial(materialId))?.error).toBe("Material not found.");
    expect((await deleteMaterial(materialId))?.error).toBe("Material not found.");
    expect(await getOwnedMaterial(materialId, { id: SEED.profB.id, role: "professor" })).toBeNull();

    actAs(SEED.profA.id);
    expect((await publishMaterial(materialId))?.success).toBe("Published.");
    const visible = (await getCourseForStudent(courseId, SEED.student.id))!.materials;
    expect(visible).toMatchObject([{ id: materialId, title: "Handout", kind: "file" }]);
    expect((visible[0] as { url: unknown }).url).toBeNull(); // never leaks a storage path via url either
    // Unenrolled student sees nothing at all.
    expect(await getCourseForStudent(courseId, SEED.student2.id)).toBeNull();

    // The signed-URL viewer query: owner preview + enrolled student both
    // resolve; an unenrolled/other actor gets null.
    expect(await getMaterialForViewer(materialId, A)).toMatchObject({ storagePath: path });
    expect(await getMaterialForViewer(materialId, { id: SEED.student.id, role: "student" })).toMatchObject({
      storagePath: path,
    });
    expect(await getMaterialForViewer(materialId, { id: SEED.student2.id, role: "student" })).toBeNull();

    expect((await unpublishMaterial(materialId))?.success).toBe("Unpublished.");
    expect((await getCourseForStudent(courseId, SEED.student.id))!.materials).toEqual([]);
    // Unpublished: even the enrolled student's viewer lookup returns null.
    expect(await getMaterialForViewer(materialId, { id: SEED.student.id, role: "student" })).toBeNull();
    await publishMaterial(materialId);
  });

  it("reorder must cover exactly the course's materials and is owner-only", async () => {
    actAs(SEED.profA.id);
    const t2 = await createMaterial(courseId, { kind: "file", title: "Second", contentType: "image/png", sizeBytes: 10 });
    if (!t2.ok || t2.kind !== "file") throw new Error("expected a file ticket");
    const before = (await getCourseForProfessor(courseId, A))!.materials.map((m) => m.id);
    expect(before).toEqual([materialId, t2.materialId]);

    expect((await reorderMaterials(courseId, { orderedIds: [t2.materialId] }))?.error).toMatch(/changed/);
    actAs(SEED.profB.id);
    expect((await reorderMaterials(courseId, { orderedIds: [t2.materialId, materialId] }))?.error).toBe(
      "Course not found.",
    );
    actAs(SEED.profA.id);
    expect((await reorderMaterials(courseId, { orderedIds: [t2.materialId, materialId] }))?.success).toBe(
      "Order saved.",
    );
    const after = (await getCourseForProfessor(courseId, A))!.materials.map((m) => m.id);
    expect(after).toEqual([t2.materialId, materialId]);
    await deleteMaterial(t2.materialId);
  });

  it("delete removes the object and the row", async () => {
    actAs(SEED.profA.id);
    storage.removed.length = 0;
    expect((await deleteMaterial(materialId))?.success).toBe("Material deleted.");
    expect(storage.removed).toEqual([path]);
    expect(await getOwnedMaterial(materialId, A)).toBeNull();
    expect((await getCourseForStudent(courseId, SEED.student.id))!.materials).toEqual([]);
  });
});

describe("course materials: link kind skips the upload step", () => {
  let courseId: string;
  let materialId: string;

  beforeAll(async () => {
    await seedUsers();
    await resetSeedData();
    ({ id: courseId } = await insertCourse({ title: "Link materials test", description: null, professorId: SEED.profA.id }));
    await inviteByEmail(courseId, SEED.student.email, SEED.profA.id);
  });
  afterAll(async () => {
    await resetSeedData();
  });

  it("rejects a non-http(s) URL before creating anything", async () => {
    actAs(SEED.profA.id);
    const t = await createMaterial(courseId, { kind: "link", title: "Bad", url: "javascript:alert(1)" });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.fieldErrors?.url).toBeTruthy();
  });

  it("creates a complete row in one step, but still starts unpublished", async () => {
    actAs(SEED.profA.id);
    const t = await createMaterial(courseId, { kind: "link", title: "External reading", url: "https://example.com/x" });
    expect(t).toMatchObject({ ok: true, kind: "link" });
    if (!t.ok || t.kind !== "link") return;
    materialId = t.materialId;

    // No upload/finalize step needed: it's already "uploaded", just unpublished.
    const owned = await getOwnedMaterial(materialId, A);
    expect(owned).toMatchObject({ kind: "link", status: "draft", url: "https://example.com/x" });
    expect(owned!.uploadedAt).not.toBeNull();

    // Publish gate still applies for visibility, same as file kind.
    expect((await getCourseForStudent(courseId, SEED.student.id))!.materials).toEqual([]);
    expect((await publishMaterial(materialId))?.success).toBe("Published.");
    const visible = (await getCourseForStudent(courseId, SEED.student.id))!.materials;
    expect(visible).toMatchObject([{ id: materialId, kind: "link", url: "https://example.com/x", mimeType: null }]);
  });

  it("a link material has no server object: the file-viewer query always returns null", async () => {
    expect(await getMaterialForViewer(materialId, A)).toBeNull();
    expect(await getMaterialForViewer(materialId, { id: SEED.student.id, role: "student" })).toBeNull();
  });

  it("delete removes the row without touching Storage", async () => {
    actAs(SEED.profA.id);
    storage.removed.length = 0;
    expect((await deleteMaterial(materialId))?.success).toBe("Material deleted.");
    expect(storage.removed).toEqual([]);
    expect(await getOwnedMaterial(materialId, A)).toBeNull();
  });
});
