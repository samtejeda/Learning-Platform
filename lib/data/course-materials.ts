import "server-only";

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { courseMaterials, courses, enrollments } from "@/lib/db/schema";
import type { Actor } from "./courses";

// Course-material reads and writes. Mirrors lib/data/lectures.ts closely:
// student functions require enrollment AND publication in the query;
// professor functions either run after findOwnedCourse or join the course
// ownership themselves (getOwnedMaterial).

export type MaterialKind = "file" | "link";
export type MaterialStatus = "pending_upload" | "draft" | "published";

export type ProfessorMaterial = {
  id: string;
  kind: MaterialKind;
  title: string;
  description: string | null;
  order: number;
  mimeType: string | null;
  url: string | null;
  status: MaterialStatus;
};

export type StudentMaterial = {
  id: string;
  kind: MaterialKind;
  title: string;
  description: string | null;
  order: number;
  /** File kind only — drives the type icon. Null for link kind. */
  mimeType: string | null;
  /** Link kind only. File kind never exposes a storage path to the
   * student; the file is fetched through the signed-URL route instead. */
  url: string | null;
};

function statusOf(row: { uploadedAt: Date | null; publishedAt: Date | null }): MaterialStatus {
  if (row.publishedAt) return "published";
  if (row.uploadedAt) return "draft";
  return "pending_upload";
}

/** Every material in a course, any status. Caller has verified ownership. */
export async function listMaterialsForProfessor(courseId: string): Promise<ProfessorMaterial[]> {
  const rows = await db
    .select({
      id: courseMaterials.id,
      kind: courseMaterials.kind,
      title: courseMaterials.title,
      description: courseMaterials.description,
      order: courseMaterials.order,
      mimeType: courseMaterials.mimeType,
      url: courseMaterials.url,
      uploadedAt: courseMaterials.uploadedAt,
      publishedAt: courseMaterials.publishedAt,
    })
    .from(courseMaterials)
    .where(eq(courseMaterials.courseId, courseId))
    .orderBy(asc(courseMaterials.order), asc(courseMaterials.createdAt));
  return rows.map(({ uploadedAt, publishedAt, ...rest }) => ({
    ...rest,
    status: statusOf({ uploadedAt, publishedAt }),
  }));
}

/**
 * Published materials only. Caller has verified enrollment
 * (getCourseForStudent); the published filter lives here so a draft can
 * never leak into a student list. File-kind rows never carry a storage
 * path here — only the signed-URL route hands one out, after re-checking
 * enrollment + published itself.
 */
export async function listPublishedMaterialsForStudent(courseId: string): Promise<StudentMaterial[]> {
  return db
    .select({
      id: courseMaterials.id,
      kind: courseMaterials.kind,
      title: courseMaterials.title,
      description: courseMaterials.description,
      order: courseMaterials.order,
      mimeType: courseMaterials.mimeType,
      url: courseMaterials.url,
    })
    .from(courseMaterials)
    .where(and(eq(courseMaterials.courseId, courseId), isNotNull(courseMaterials.publishedAt)))
    .orderBy(asc(courseMaterials.order), asc(courseMaterials.createdAt));
}

// ─── Professor-side single material (ownership joined) ─────────────────────────

export type OwnedMaterial = {
  id: string;
  courseId: string;
  kind: MaterialKind;
  title: string;
  description: string | null;
  storagePath: string | null;
  mimeType: string | null;
  url: string | null;
  uploadedAt: Date | null;
  publishedAt: Date | null;
  status: MaterialStatus;
};

/**
 * The material if the actor may manage its course (professor = own course,
 * admin = any), else null. Ownership is part of the query so a material id
 * alone never grants access.
 */
export async function getOwnedMaterial(materialId: string, actor: Actor): Promise<OwnedMaterial | null> {
  const ownership =
    actor.role === "admin"
      ? eq(courseMaterials.id, materialId)
      : and(eq(courseMaterials.id, materialId), eq(courses.professorId, actor.id));
  const [row] = await db
    .select({
      id: courseMaterials.id,
      courseId: courseMaterials.courseId,
      kind: courseMaterials.kind,
      title: courseMaterials.title,
      description: courseMaterials.description,
      storagePath: courseMaterials.storagePath,
      mimeType: courseMaterials.mimeType,
      url: courseMaterials.url,
      uploadedAt: courseMaterials.uploadedAt,
      publishedAt: courseMaterials.publishedAt,
    })
    .from(courseMaterials)
    .innerJoin(courses, eq(courseMaterials.courseId, courses.id))
    .where(ownership)
    .limit(1);
  if (!row) return null;
  return { ...row, status: statusOf(row) };
}

/**
 * What an enrolled student (or the owning professor/admin, for preview) may
 * download for a file-kind material, or null. Mirrors getLectureForViewer:
 * students need enrollment AND published; the owner may preview any status.
 * Link-kind materials have no server object, so they always return null
 * here (the route handler is file-only; a link is rendered straight from
 * the page data as a plain outbound <a>).
 */
export async function getMaterialForViewer(
  materialId: string,
  actor: Actor,
): Promise<{ id: string; courseId: string; storagePath: string } | null> {
  if (actor.role === "professor" || actor.role === "admin") {
    const owned = await getOwnedMaterial(materialId, actor);
    if (owned) {
      if (owned.kind !== "file" || !owned.storagePath) return null;
      return { id: owned.id, courseId: owned.courseId, storagePath: owned.storagePath };
    }
  }
  const [row] = await db
    .select({
      id: courseMaterials.id,
      courseId: courseMaterials.courseId,
      storagePath: courseMaterials.storagePath,
    })
    .from(courseMaterials)
    .innerJoin(
      enrollments,
      and(eq(enrollments.courseId, courseMaterials.courseId), eq(enrollments.studentId, actor.id)),
    )
    .where(
      and(
        eq(courseMaterials.id, materialId),
        eq(courseMaterials.kind, "file"),
        isNotNull(courseMaterials.publishedAt),
      ),
    )
    .limit(1);
  if (!row?.storagePath) return null;
  return { id: row.id, courseId: row.courseId, storagePath: row.storagePath };
}

// ─── Writes (caller has verified ownership of the course) ─────────────────────

/** Create a pending-upload file-kind row. `id` and `storagePath` are
 * generated by the caller so the storage path can embed the material id. */
export async function insertFileMaterial(input: {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  storagePath: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${courseMaterials.order}), -1) + 1` })
      .from(courseMaterials)
      .where(eq(courseMaterials.courseId, input.courseId));
    await tx.insert(courseMaterials).values({ ...input, kind: "file", order: next });
  });
}

/** Create a link-kind row. There is no upload step: uploadedAt is set now,
 * so the only remaining gate before students can see it is publish. */
export async function insertLinkMaterial(input: {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  url: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${courseMaterials.order}), -1) + 1` })
      .from(courseMaterials)
      .where(eq(courseMaterials.courseId, input.courseId));
    await tx.insert(courseMaterials).values({ ...input, kind: "link", uploadedAt: new Date(), order: next });
  });
}

export async function markMaterialUploaded(materialId: string, mimeType: string): Promise<void> {
  await db
    .update(courseMaterials)
    .set({ uploadedAt: new Date(), mimeType, updatedAt: new Date() })
    .where(eq(courseMaterials.id, materialId));
}

/** Publish only if the material is actually uploaded; returns false otherwise. */
export async function setMaterialPublished(materialId: string, published: boolean): Promise<boolean> {
  const rows = await db
    .update(courseMaterials)
    .set({ publishedAt: published ? new Date() : null, updatedAt: new Date() })
    .where(
      published
        ? and(eq(courseMaterials.id, materialId), isNotNull(courseMaterials.uploadedAt))
        : eq(courseMaterials.id, materialId),
    )
    .returning({ id: courseMaterials.id });
  return rows.length > 0;
}

export async function updateMaterialRow(
  materialId: string,
  input: { title: string; description: string | null },
): Promise<void> {
  await db.update(courseMaterials).set({ ...input, updatedAt: new Date() }).where(eq(courseMaterials.id, materialId));
}

/**
 * Apply a full new order. Every id must belong to the course and the list
 * must cover every material in it, otherwise nothing changes (returns
 * false). One transaction so a partial order can never be observed.
 */
export async function reorderCourseMaterials(courseId: string, orderedIds: string[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: courseMaterials.id })
      .from(courseMaterials)
      .where(eq(courseMaterials.courseId, courseId));
    const existingIds = new Set(existing.map((r) => r.id));
    if (existingIds.size !== orderedIds.length || !orderedIds.every((id) => existingIds.has(id))) {
      return false;
    }
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(courseMaterials)
        .set({ order: index, updatedAt: new Date() })
        .where(and(eq(courseMaterials.id, id), eq(courseMaterials.courseId, courseId)));
    }
    return true;
  });
}

export async function deleteMaterialRow(materialId: string): Promise<void> {
  await db.delete(courseMaterials).where(eq(courseMaterials.id, materialId));
}

/** Storage paths for a set of file-kind materials (used for cleanup). */
export async function listMaterialStoragePaths(materialIds: string[]): Promise<string[]> {
  if (materialIds.length === 0) return [];
  const rows = await db
    .select({ path: courseMaterials.storagePath })
    .from(courseMaterials)
    .where(and(inArray(courseMaterials.id, materialIds), isNotNull(courseMaterials.storagePath)));
  return rows.map((r) => r.path!).filter(Boolean);
}
