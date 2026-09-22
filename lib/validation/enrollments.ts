import { z } from "zod";
import { emailSchema } from "./auth";
import { uuidSchema } from "./courses";

export const inviteSchema = z.object({
  email: emailSchema, // trimmed + lowercased, so invitations match users.email
});

export const removeStudentSchema = z.object({
  studentId: uuidSchema,
});

export const revokeInvitationSchema = z.object({
  invitationId: uuidSchema,
});
