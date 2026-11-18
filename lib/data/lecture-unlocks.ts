import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  courses,
  enrollments,
  lectureComprehensionAttempts,
  lectureComprehensionUnlocks,
  lectures,
  users,
} from "@/lib/db/schema";
import { COMPREHENSION_MAX_ATTEMPTS } from "@/lib/lectures/comprehension";
import type { Actor } from "./courses";

// Professor unlocks. An unlock counts as "cleared" for locking the next lecture
// (lib/data/lecture-locks.ts reads this table) and never alters attempt history:
// the attempts stay exactly as the student left them, and the unlock row records
// who let them through and when. Ownership and enrollment are part of the query,
// so a lecture id or student id alone grants nothing.

function ownership(actor: Actor) {
  return actor.role === "admin" ? undefined : eq(courses.professorId, actor.id);
}

export type UnlockResult =
  | { ok: true; courseId: string; /** False when the student was already unlocked (no-op). */ created: boolean }
  | { ok: false; reason: "not_found" };

/**
 * Unlock one enrolled student on one lecture of a course the actor manages.
 * Idempotent. "Not found" covers an unknown lecture, someone else's course and
 * a student who isn't enrolled, so none of them can be told apart.
 */
export async function unlockStudentForLecture(
  lectureId: string,
  studentId: string,
  actor: Actor,
): Promise<UnlockResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ lectureId: lectures.id, courseId: lectures.courseId })
      .from(lectures)
      .innerJoin(courses, eq(lectures.courseId, courses.id))
      .innerJoin(
        enrollments,
        and(eq(enrollments.courseId, lectures.courseId), eq(enrollments.studentId, studentId)),
      )
      .where(and(eq(lectures.id, lectureId), ownership(actor)))
      .limit(1);
    if (!row) return { ok: false, reason: "not_found" } as const;

    const inserted = await tx
      .insert(lectureComprehensionUnlocks)
      .values({ lectureId: row.lectureId, studentId, unlockedBy: actor.id })
      .onConflictDoNothing({
        target: [lectureComprehensionUnlocks.lectureId, lectureComprehensionUnlocks.studentId],
      })
      .returning({ id: lectureComprehensionUnlocks.id });
    return { ok: true, courseId: row.courseId, created: inserted.length > 0 } as const;
  });
}

export type BlockedStudent = {
  lectureId: string;
  lectureTitle: string;
  studentId: string;
  /** Same identity fields the roster already shows, nothing more. */
  name: string | null;
  email: string | null;
  /** When the second wrong attempt was recorded (longest-waiting first). */
  blockedAt: Date;
};

/**
 * Students of a course the actor manages who used every attempt on a published
 * lecture's enabled question without a correct answer and have not been
 * unlocked. Ownership is joined in the query (admins see any course); a course
 * someone else owns yields an empty list. Answers aren't stored, so none can leak.
 */
export async function listBlockedStudents(courseId: string, actor: Actor): Promise<BlockedStudent[]> {
  const rows = await db
    .select({
      lectureId: lectures.id,
      lectureTitle: lectures.title,
      studentId: users.id,
      name: users.fullName,
      email: users.email,
      blockedAt: sql<Date>`max(${lectureComprehensionAttempts.createdAt})`,
    })
    .from(lectureComprehensionAttempts)
    .innerJoin(lectures, eq(lectureComprehensionAttempts.lectureId, lectures.id))
    .innerJoin(courses, eq(lectures.courseId, courses.id))
    .innerJoin(
      enrollments,
      and(eq(enrollments.courseId, lectures.courseId), eq(enrollments.studentId, lectureComprehensionAttempts.studentId)),
    )
    .innerJoin(users, eq(users.id, lectureComprehensionAttempts.studentId))
    .leftJoin(
      lectureComprehensionUnlocks,
      and(
        eq(lectureComprehensionUnlocks.lectureId, lectureComprehensionAttempts.lectureId),
        eq(lectureComprehensionUnlocks.studentId, lectureComprehensionAttempts.studentId),
      ),
    )
    .where(
      and(
        eq(courses.id, courseId),
        ownership(actor),
        eq(lectures.comprehensionEnabled, true),
        sql`${lectures.publishedAt} is not null`,
        isNull(lectureComprehensionUnlocks.id),
      ),
    )
    .groupBy(lectures.id, lectures.title, lectures.order, users.id, users.fullName, users.email)
    .having(
      sql`count(*) >= ${COMPREHENSION_MAX_ATTEMPTS} and bool_or(${lectureComprehensionAttempts.correct}) = false`,
    )
    .orderBy(asc(sql`max(${lectureComprehensionAttempts.createdAt})`), asc(users.fullName), asc(users.email));
  return rows.map((r) => ({ ...r, blockedAt: new Date(r.blockedAt) }));
}
