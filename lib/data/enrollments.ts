import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { courseInvitations, enrollments, users } from "@/lib/db/schema";

// Roster reads. Called only after findOwnedCourse has confirmed the actor
// may manage the course; the course id is the only filter needed here.

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
