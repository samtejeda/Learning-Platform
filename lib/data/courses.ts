import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { courses, enrollments, lectures, users } from "@/lib/db/schema";

// Every function takes the acting user's id and encodes the permission rule
// in the query itself (enrollment join / professor ownership), so a caller
// can't accidentally read a course the user isn't allowed to see.

export type CourseSummary = {
  id: string;
  title: string;
  description: string | null;
};

export type CourseDetail = CourseSummary & {
  professorName: string | null;
  lectures: { id: string; title: string; order: number }[];
};

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

/** A course the student is enrolled in, or null if not enrolled / not found. */
export async function getCourseForStudent(
  courseId: string,
  studentId: string,
): Promise<CourseDetail | null> {
  const [row] = await db
    .select({ ...summaryColumns, professorName: users.fullName })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(courses.professorId, users.id))
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.courseId, courseId)))
    .limit(1);
  if (!row) return null;
  return { ...row, lectures: await listLectureTitles(courseId) };
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
 * A course for the professor view. Professors see only their own courses;
 * admins (`isAdmin`) see any course. Null if not found or not owned.
 */
export async function getCourseForProfessor(
  courseId: string,
  professorId: string,
  { isAdmin = false }: { isAdmin?: boolean } = {},
): Promise<CourseDetail | null> {
  const ownership = isAdmin
    ? eq(courses.id, courseId)
    : and(eq(courses.id, courseId), eq(courses.professorId, professorId));
  const [row] = await db
    .select({ ...summaryColumns, professorName: users.fullName })
    .from(courses)
    .innerJoin(users, eq(courses.professorId, users.id))
    .where(ownership)
    .limit(1);
  if (!row) return null;
  return { ...row, lectures: await listLectureTitles(courseId) };
}

/** All courses (admin only; caller must have checked the role). */
export async function listAllCourses(): Promise<(CourseSummary & { professorName: string | null })[]> {
  return db
    .select({ ...summaryColumns, professorName: users.fullName })
    .from(courses)
    .innerJoin(users, eq(courses.professorId, users.id))
    .orderBy(asc(courses.title));
}

async function listLectureTitles(courseId: string) {
  return db
    .select({ id: lectures.id, title: lectures.title, order: lectures.order })
    .from(lectures)
    .where(eq(lectures.courseId, courseId))
    .orderBy(asc(lectures.order));
}
