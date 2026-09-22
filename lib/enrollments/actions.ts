"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth/session";
import { findOwnedCourse } from "@/lib/data/courses";
import { inviteByEmail, removeEnrollment, removeInvitation } from "@/lib/data/enrollments";
import { enforceRateLimit } from "@/lib/rate-limit";
import { parseFormData, type ActionState } from "@/lib/validation/form";
import { uuidSchema } from "@/lib/validation/courses";
import { inviteSchema, removeStudentSchema, revokeInvitationSchema } from "@/lib/validation/enrollments";

// All three take a bound courseId from the page. It is untrusted input:
// validated as a UUID, then findOwnedCourse decides whether this professor
// (or an admin) may manage the roster. Not-owned and not-found are the
// same generic answer.

async function ownedCourseOrError(courseId: string) {
  const user = await assertRole("professor", "admin");
  const id = uuidSchema.safeParse(courseId);
  if (!id.success) return { error: "Course not found." as const };
  const owned = await findOwnedCourse(id.data, user);
  if (!owned) return { error: "Course not found." as const };
  return { user, courseId: id.data };
}

/** Invite a student by email; enrolls immediately if the account exists. */
export async function inviteStudent(
  courseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await ownedCourseOrError(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const parsed = parseFormData(inviteSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { email } = parsed.data;

  const limited = await enforceRateLimit("invite", ctx.user.id);
  if (limited) return { error: limited, values: { email } };

  const outcome = await inviteByEmail(ctx.courseId, email, ctx.user.id);
  revalidatePath(`/professor/courses/${ctx.courseId}`);

  switch (outcome) {
    case "enrolled":
      return { success: `${email} is now enrolled.` };
    case "invited":
      return { success: `${email} is invited and will be enrolled when they create an account.` };
    case "already":
      return { success: `${email} is already on the roster.` };
  }
}

/** Unenroll a student (hidden field `studentId`). */
export async function removeStudent(
  courseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await ownedCourseOrError(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const parsed = parseFormData(removeStudentSchema, formData);
  if (!parsed.ok) return { error: "Student not found." };

  const ok = await removeEnrollment(ctx.courseId, parsed.data.studentId);
  revalidatePath(`/professor/courses/${ctx.courseId}`);
  return ok ? { success: "Student removed." } : { error: "Student not found." };
}

/** Withdraw a pending invitation (hidden field `invitationId`). */
export async function revokeInvitation(
  courseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await ownedCourseOrError(courseId);
  if ("error" in ctx) return { error: ctx.error };

  const parsed = parseFormData(revokeInvitationSchema, formData);
  if (!parsed.ok) return { error: "Invitation not found." };

  const ok = await removeInvitation(ctx.courseId, parsed.data.invitationId);
  revalidatePath(`/professor/courses/${ctx.courseId}`);
  return ok ? { success: "Invitation withdrawn." } : { error: "Invitation not found." };
}
