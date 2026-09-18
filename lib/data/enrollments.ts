import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { courseInvitations, enrollments, users } from "@/lib/db/schema";

// Roster reads and writes. Every function here is called only after
// findOwnedCourse has confirmed the actor may manage the course, so the
// course id is the ownership boundary and is part of every WHERE.

export type Roster = {
  enrolled: { studentId: string; name: string | null; email: string | null; enrolledAt: Date }[];
  invited: { id: string; email: string; invitedAt: Date }[];
};

export async function listRoster(courseId: string): Promise<Roster> {
  const [enrolled, invited] = await Promise.all([
    db
      .select({
        studentId: enrollments.studentId,
        name: users.fullName,
        email: users.email,
        enrolledAt: enrollments.enrolledAt,
      })
      .from(enrollments)
      .innerJoin(users, eq(enrollments.studentId, users.id))
      .where(eq(enrollments.courseId, courseId))
      .orderBy(asc(users.fullName), asc(users.email)),
    db
      .select({
        id: courseInvitations.id,
        email: courseInvitations.email,
        invitedAt: courseInvitations.createdAt,
      })
      .from(courseInvitations)
      .where(and(eq(courseInvitations.courseId, courseId), isNull(courseInvitations.acceptedAt)))
      .orderBy(asc(courseInvitations.createdAt)),
  ]);
  return { enrolled, invited };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export type InviteOutcome = "enrolled" | "invited" | "already";

/**
 * Invite a student by (lowercased) email. If an account with that email
 * exists the enrollment is created now and the invitation recorded as
 * accepted; otherwise the invitation waits for the DB trigger
 * (drizzle/0006) to enroll them when they sign up. One transaction so the
 * two rows can't drift. Idempotent: inviting twice is a no-op ("already").
 */
export async function inviteByEmail(
  courseId: string,
  email: string,
  invitedBy: string,
): Promise<InviteOutcome> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      const inserted = await tx
        .insert(enrollments)
        .values({ studentId: existing.id, courseId })
        .onConflictDoNothing()
        .returning({ id: enrollments.id });
      await tx
        .insert(courseInvitations)
        .values({ courseId, email, invitedBy, acceptedAt: new Date() })
        .onConflictDoUpdate({
          target: [courseInvitations.courseId, courseInvitations.email],
          set: { acceptedAt: new Date() },
        });
      return inserted.length > 0 ? "enrolled" : "already";
    }

    const inserted = await tx
      .insert(courseInvitations)
      .values({ courseId, email, invitedBy })
      .onConflictDoNothing()
      .returning({ id: courseInvitations.id });
    return inserted.length > 0 ? "invited" : "already";
  });
}

/** Unenroll a student. Also clears their accepted invitation so a later
 * re-invite works. Returns false if they weren't enrolled. */
export async function removeEnrollment(courseId: string, studentId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
      .returning({ id: enrollments.id });
    if (removed.length === 0) return false;
    const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, studentId)).limit(1);
    if (u?.email) {
      await tx
        .delete(courseInvitations)
        .where(and(eq(courseInvitations.courseId, courseId), eq(courseInvitations.email, u.email)));
    }
    return true;
  });
}

/** Withdraw a pending invitation. Returns false if none matched. */
export async function removeInvitation(courseId: string, invitationId: string): Promise<boolean> {
  const removed = await db
    .delete(courseInvitations)
    .where(
      and(
        eq(courseInvitations.courseId, courseId),
        eq(courseInvitations.id, invitationId),
        isNull(courseInvitations.acceptedAt),
      ),
    )
    .returning({ id: courseInvitations.id });
  return removed.length > 0;
}
