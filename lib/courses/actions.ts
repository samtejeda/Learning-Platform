"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth/session";
import { findOwnedCourse, insertCourse, updateCourse as updateCourseRow } from "@/lib/data/courses";
import { parseFormData, type ActionState } from "@/lib/validation/form";
import { courseFormSchema, uuidSchema } from "@/lib/validation/courses";

// Conventions (see API.md): form actions return ActionState on expected
// failure and only redirect() on success, outside any try/catch.

/** Create a course owned by the acting professor (admins may create too). */
export async function createCourse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await assertRole("professor", "admin");

  const parsed = parseFormData(courseFormSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { id } = await insertCourse({ ...parsed.data, professorId: user.id });
  revalidatePath("/professor");
  redirect(`/professor/courses/${id}`);
}

/**
 * Update title/description. `courseId` is a bound argument from the page,
 * so it is treated as untrusted input: validated as a UUID and then
 * ownership is enforced in the UPDATE's WHERE clause.
 */
export async function updateCourse(
  courseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await assertRole("professor", "admin");

  const id = uuidSchema.safeParse(courseId);
  if (!id.success) return { error: "Course not found." };

  const parsed = parseFormData(courseFormSchema, formData);
  if (!parsed.ok) return parsed.state;

  const owned = await findOwnedCourse(id.data, user);
  if (!owned) return { error: "Course not found." };

  const ok = await updateCourseRow(id.data, user, parsed.data);
  if (!ok) return { error: "Course not found." };

  revalidatePath(`/professor/courses/${id.data}`);
  revalidatePath("/professor");
  redirect(`/professor/courses/${id.data}`);
}
