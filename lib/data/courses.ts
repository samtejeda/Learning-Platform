import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { courses, enrollments, users } from "@/lib/db/schema";
import type { Role } from "@/lib/auth/roles";
import { listLecturesForProfessor, listPublishedLecturesForStudent, type ProfessorLecture, type StudentLecture } from "./lectures";
import { listRoster, type Roster } from "./enrollments";

// Every function takes the acting user's id and encodes the permission rule
// in the query itself (enrollment join / professor ownership), so a caller
// can't accidentally read a course the user isn't allowed to see.

export type CourseSummary = {
  id: string;
  title: string;
  description: string | null;
};

export type StudentCourseDetail = CourseSummary & {
  professorName: string | null;
  lectures: StudentLecture[];
};

export type ProfessorCourseDetail = CourseSummary & {
  professorName: string | null;
  lectures: ProfessorLecture[];
  roster: Roster;
};

/** The minimum identity a data function needs to decide ownership. */
export type Actor = { id: string; role: Role };

const summaryColumns = {
  id: courses.id,
  title: courses.title,
  description: courses.description,
};

/** Courses the student is enrolled in. */
export async function listEnrolledCourses(studentId: string): Promise<CourseSummary[]> {
  return db
    .select(summaryColumns)
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(eq(enrollments.studentId, studentId))
    .orderBy(asc(courses.title));
}

/** A course the student is enrolled in, or null if not enrolled / not found.
 * Only published lectures are included. */
export async function getCourseForStudent(
  courseId: string,
  studentId: string,
): Promise<StudentCourseDetail | null> {
  const [row] = await db
    .select({ ...summaryColumns, professorName: users.fullName })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(courses.professorId, users.id))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.courseId, courseId)))
    .limit(1);
  if (!row) return null;
  return { ...row, lectures: await listPublishedLecturesForStudent(courseId, studentId) };
}

/** Courses taught by the professor. */
export async function listTaughtCourses(professorId: string): Promise<CourseSummary[]> {
  return db
    .select(summaryColumns)
    .from(courses)
    .where(eq(courses.professorId, professorId))
    .orderBy(asc(courses.title));
}

/**
 * Ownership predicate shared by every professor-side read and write:
 * professors match only their own courses, admins match any course.
 */
function ownedBy(courseId: string, actor: Actor) {
  return actor.role === "admin"
    ? eq(courses.id, courseId)
    : and(eq(courses.id, courseId), eq(courses.professorId, actor.id));
}

/**
 * The course if the actor may manage it, else null. Every mutating action
 * calls this first (after assertRole) so a professor can't touch a course
 * they don't own even with a valid id. Not-owned and not-found are the same
 * answer on purpose.
 */
export async function findOwnedCourse(
  courseId: string,
  actor: Actor,
): Promise<{ id: string; professorId: string } | null> {
  const [row] = await db
    .select({ id: courses.id, professorId: courses.professorId })
    .from(courses)
    .where(ownedBy(courseId, actor))
    .limit(1);
  return row ?? null;
}

/**
 * A course for the professor view. Professors see only their own courses;
 * admins see any course. Null if not found or not owned. Includes every
 * lecture (any status) and the roster.
 */
export async function getCourseForProfessor(
  courseId: string,
  actor: Actor,
): Promise<ProfessorCourseDetail | null> {
  const [row] = await db
    .select({ ...summaryColumns, professorName: users.fullName })
    .from(courses)
    .innerJoin(users, eq(courses.professorId, users.id))
    .where(ownedBy(courseId, actor))
    .limit(1);
  if (!row) return null;
  const [lectureRows, roster] = await Promise.all([
    listLecturesForProfessor(courseId),
    listRoster(courseId),
  ]);
  return { ...row, lectures: lectureRows, roster };
}

/** All courses (admin only; caller must have checked the role). */
export async function listAllCourses(): Promise<(CourseSummary & { professorName: string | null })[]> {
  return db
    .select({ ...summaryColumns, professorName: users.fullName })
    .from(courses)
    .innerJoin(users, eq(courses.professorId, users.id))
    .orderBy(asc(courses.title));
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function insertCourse(input: {
  title: string;
  description: string | null;
  professorId: string;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(courses)
    .values(input)
    .returning({ id: courses.id });
  return row;
}

/** Update title/description. Ownership is part of the WHERE; returns false
 * if nothing matched (not found or not owned). */
export async function updateCourse(
  courseId: string,
  actor: Actor,
  input: { title: string; description: string | null },
): Promise<boolean> {
  const rows = await db
    .update(courses)
    .set({ ...input, updatedAt: new Date() })
    .where(ownedBy(courseId, actor))
    .returning({ id: courses.id });
  return rows.length > 0;
}
