"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth/session";
import { findOwnedCourse } from "@/lib/data/courses";
import {
  deleteMaterialRow,
  getOwnedMaterial,
  insertFileMaterial,
  insertLinkMaterial,
  markMaterialUploaded,
  reorderCourseMaterials,
  setMaterialPublished,
  updateMaterialRow,
} from "@/lib/data/course-materials";
import {
  courseMaterialObjectPath,
  createCourseFileUploadUrl,
  getCourseFileInfo,
  isCourseFileMimeType,
  removeCourseFileObjects,
  COURSE_FILES_BUCKET,
  StorageError,
} from "@/lib/storage";
import { logger } from "@/lib/logger";
import { parseFormData, parseObject, type ActionState } from "@/lib/validation/form";
import {
  createMaterialSchema,
  finalizeMaterialSchema,
  materialFormSchema,
  reorderMaterialsSchema,
  uuidSchema,
} from "@/lib/validation/course-materials";

// Upload flow (see API.md), same shape as lectures for the file kind:
//   1. createMaterial       → for kind='file': pending row + one-time signed
//                              upload token. For kind='link': the row is
//                              complete immediately (no upload step) but
//                              still starts unpublished.
//   2. browser              → uploadToSignedUrl(path, token, file)  (file kind only)
//   3. finalizeMaterialUpload → server confirms the object exists (file kind only)
//   4. publishMaterial      → visible to enrolled students
// Every step re-validates its ids and re-checks ownership; nothing trusts
// the previous step's client-side state.

const NOT_FOUND = "Material not found.";
const COURSE_NOT_FOUND = "Course not found.";

export type MaterialActionResult =
  | { ok: true; kind: "file"; materialId: string; bucket: string; path: string; token: string }
  | { ok: true; kind: "link"; materialId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function ownedMaterialOrNull(materialId: string) {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(materialId);
  if (!id.success) return null;
  return getOwnedMaterial(id.data, user);
}

/** Step 1: create the material row. File kind hands back a signed upload
 * token; link kind is done in one step. */
export async function createMaterial(courseId: string, input: unknown): Promise<MaterialActionResult> {
  const user = await assertRole("professor", "admin");

  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { ok: false, error: COURSE_NOT_FOUND };
  const parsed = parseObject(createMaterialSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return { ok: false, error: parsed.state.error!, fieldErrors: parsed.state.fieldErrors };

  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { ok: false, error: COURSE_NOT_FOUND };

  if (parsed.data.kind === "link") {
    const materialId = randomUUID();
    await insertLinkMaterial({
      id: materialId,
      courseId: owned.id,
      title: parsed.data.title,
      description: parsed.data.description,
      url: parsed.data.url,
    });
    revalidatePath(`/professor/courses/${owned.id}`);
    return { ok: true, kind: "link", materialId };
  }

  const materialId = randomUUID();
  const path = courseMaterialObjectPath(owned.id, materialId, parsed.data.contentType);
  await insertFileMaterial({
    id: materialId,
    courseId: owned.id,
    title: parsed.data.title,
    description: parsed.data.description,
    storagePath: path,
  });

  try {
    const { token } = await createCourseFileUploadUrl(path);
    revalidatePath(`/professor/courses/${owned.id}`);
    return { ok: true, kind: "file", materialId, bucket: COURSE_FILES_BUCKET, path, token };
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    // Row stays as "pending upload" so the professor can retry or delete.
    revalidatePath(`/professor/courses/${owned.id}`);
    return { ok: false, error: "Upload is unavailable right now. Please try again." };
  }
}

/** Re-issue an upload token for a file-kind material whose upload never completed. */
export async function retryMaterialUpload(materialId: string): Promise<MaterialActionResult> {
  const material = await ownedMaterialOrNull(materialId);
  if (!material) return { ok: false, error: NOT_FOUND };
  if (material.kind !== "file" || !material.storagePath) {
    return { ok: false, error: "This material isn't a file upload." };
  }
  if (material.uploadedAt) return { ok: false, error: "This material already has a file." };
  try {
    const { token } = await createCourseFileUploadUrl(material.storagePath);
    return { ok: true, kind: "file", materialId: material.id, bucket: COURSE_FILES_BUCKET, path: material.storagePath, token };
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { ok: false, error: "Upload is unavailable right now. Please try again." };
  }
}

/** Step 3 (file kind only): confirm the object landed and record its MIME type. */
export async function finalizeMaterialUpload(materialId: string, input: unknown): Promise<ActionState> {
  const material = await ownedMaterialOrNull(materialId);
  if (!material) return { error: NOT_FOUND };
  if (material.kind !== "file" || !material.storagePath) {
    return { error: "This material isn't a file upload." };
  }

  const parsed = parseObject(finalizeMaterialSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return parsed.state;

  let info;
  try {
    info = await getCourseFileInfo(material.storagePath);
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    return { error: "We couldn't verify the upload. Please try again." };
  }
  if (!info) return { error: "The file hasn't finished uploading yet." };
  if (!isCourseFileMimeType(info.contentType ?? "")) {
    // Something other than an allowlisted file ended up at the path; refuse it.
    await removeCourseFileObjects([material.storagePath]).catch(() => {});
    return { error: "That file type isn't supported." };
  }

  await markMaterialUploaded(material.id, info.contentType!);
  revalidatePath(`/professor/courses/${material.courseId}`);
  return { success: "File uploaded. Publish it when you're ready." };
}

// publish/unpublish/delete take only the bound id; useActionState's `prev`
// argument (and a form's FormData) are accepted and ignored at runtime.
export async function publishMaterial(materialId: string): Promise<ActionState> {
  const material = await ownedMaterialOrNull(materialId);
  if (!material) return { error: NOT_FOUND };
  if (!material.uploadedAt) return { error: "Upload a file before publishing." };
  await setMaterialPublished(material.id, true);
  revalidatePath(`/professor/courses/${material.courseId}`);
  revalidatePath(`/courses/${material.courseId}`);
  return { success: "Published." };
}

export async function unpublishMaterial(materialId: string): Promise<ActionState> {
  const material = await ownedMaterialOrNull(materialId);
  if (!material) return { error: NOT_FOUND };
  await setMaterialPublished(material.id, false);
  revalidatePath(`/professor/courses/${material.courseId}`);
  revalidatePath(`/courses/${material.courseId}`);
  return { success: "Unpublished." };
}

export async function updateMaterial(
  materialId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const material = await ownedMaterialOrNull(materialId);
  if (!material) return { error: NOT_FOUND };
  const parsed = parseFormData(materialFormSchema, formData);
  if (!parsed.ok) return parsed.state;
  await updateMaterialRow(material.id, parsed.data);
  revalidatePath(`/professor/courses/${material.courseId}`);
  redirect(`/professor/courses/${material.courseId}`);
}

/** Full new order for a course's materials. */
export async function reorderMaterials(courseId: string, input: unknown): Promise<ActionState> {
  const user = await assertRole("professor", "admin");
  const cid = uuidSchema.safeParse(courseId);
  if (!cid.success) return { error: COURSE_NOT_FOUND };
  const parsed = parseObject(reorderMaterialsSchema, (input ?? {}) as Record<string, unknown>);
  if (!parsed.ok) return parsed.state;
  const owned = await findOwnedCourse(cid.data, user);
  if (!owned) return { error: COURSE_NOT_FOUND };
  const ok = await reorderCourseMaterials(owned.id, parsed.data.orderedIds);
  if (!ok) return { error: "The material list changed. Refresh and try again." };
  revalidatePath(`/professor/courses/${owned.id}`);
  return { success: "Order saved." };
}

/** Delete the row and, for file kind, its object. Object removal is
 * attempted first; if Storage is unavailable the row is still deleted (an
 * orphaned object is recoverable, an undeletable material is not) and the
 * failure is logged. */
export async function deleteMaterial(materialId: string): Promise<ActionState> {
  const material = await ownedMaterialOrNull(materialId);
  if (!material) return { error: NOT_FOUND };
  if (material.kind === "file" && material.storagePath) {
    try {
      await removeCourseFileObjects([material.storagePath]);
    } catch (err) {
      logger.error("course_materials.orphaned_object_after_delete", { path: material.storagePath, err });
    }
  }
  await deleteMaterialRow(material.id);
  revalidatePath(`/professor/courses/${material.courseId}`);
  revalidatePath(`/courses/${material.courseId}`);
  return { success: "Material deleted." };
}
