import { z } from "zod";

// ─── Primitives ───────────────────────────────────────────────────────────────

export const emailSchema = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .pipe(z.email("Enter a valid email address."));

// 72 bytes is bcrypt's input limit; Supabase (GoTrue) uses bcrypt.
export const passwordSchema = z
  .string({ error: "Password is required." })
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.");

/** Accepts common human formatting, normalises to E.164 (+15551234567). */
export const phoneSchema = z
  .string({ error: "Phone number is required." })
  .trim()
  .min(1, "Phone number is required.")
  .transform((value) => value.replace(/[\s\-().]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/, "Enter your phone number with country code, e.g. +1 555 123 4567."),
  );

export const otpTokenSchema = z
  .string({ error: "Verification code is required." })
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code.");

export const fullNameSchema = z
  .string({ error: "Full name is required." })
  .trim()
  .min(1, "Full name is required.")
  .max(100, "Full name is too long.");

// ─── Forms ────────────────────────────────────────────────────────────────────

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Password is required." }).min(1, "Password is required."),
  next: z.string().optional(),
});

export const signUpSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: "Please confirm your password." }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const resetRequestSchema = z.object({
  email: emailSchema,
});

export const resendConfirmationSchema = z.object({
  email: emailSchema,
});

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string({ error: "Please confirm your password." }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const sendOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  token: otpTokenSchema,
  next: z.string().optional(),
});
