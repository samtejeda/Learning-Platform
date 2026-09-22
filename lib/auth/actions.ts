"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { parseFormData, parseObject, type ActionState } from "@/lib/validation/form";
import {
  resetRequestSchema,
  sendOtpSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  verifyOtpSchema,
} from "@/lib/validation/auth";
import { homeForRole, safeNextPath } from "./roles";
import { getCurrentUser } from "./session";

// Conventions (see API.md):
//  - Form actions: (prev: ActionState, formData) => Promise<ActionState>.
//  - Expected failures RETURN { error }; never throw.
//  - redirect() only on success, never inside try/catch.
//  - Error messages never reveal whether an account exists.

const GENERIC_SIGN_IN_ERROR = "Invalid email or password.";
const GENERIC_OTP_ERROR = "Invalid or expired code.";
const SIGN_UP_SUCCESS = "Account created! Check your email to confirm before signing in.";

function destination(next: string | undefined): string {
  const safe = safeNextPath(next);
  // "/" is the role router (app/page.tsx); it lands the user on their home.
  return safe === "/" ? "/" : safe;
}

export async function signInWithEmail(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseFormData(signInSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { email, password, next } = parsed.data;

  const limited = await enforceAuthRateLimit("login", email);
  if (limited) return { error: limited, values: { email } };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Scope and code only: no email, so a spike is alertable without logging
    // who was targeted.
    logger.warn("auth.sign_in_failed", { reason: error.code ?? error.status });
    return { error: GENERIC_SIGN_IN_ERROR, values: { email } };
  }

  redirect(destination(next));
}

export async function sendPhoneOTP(input: { phone: string }): Promise<ActionState> {
  const parsed = parseObject(sendOtpSchema, input);
  if (!parsed.ok) return parsed.state;
  const { phone } = parsed.data;

  const limited = await enforceAuthRateLimit("otp_send", phone);
  if (limited) return { error: limited, values: { phone } };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    // Sign-in only: a phone number that isn't already on an account cannot
    // create one (decision: no self-provisioning by phone, minors may use
    // the platform). Supabase returns an error for unknown numbers; we
    // return the same message either way so numbers can't be enumerated.
    options: { shouldCreateUser: false },
  });
  if (error) {
    return {
      error: "We couldn't send a code to that number. Check it and try again.",
      values: { phone },
    };
  }
  return { success: "Code sent.", values: { phone } };
}

export async function verifyPhoneOTP(input: {
  phone: string;
  token: string;
  next?: string;
}): Promise<ActionState> {
  const parsed = parseObject(verifyOtpSchema, input);
  if (!parsed.ok) return parsed.state;
  const { phone, token, next } = parsed.data;

  const limited = await enforceAuthRateLimit("otp_verify", phone);
  if (limited) return { error: limited, values: { phone } };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) {
    logger.warn("auth.otp_verify_failed", { reason: error.code ?? error.status });
    return { error: GENERIC_OTP_ERROR, values: { phone } };
  }

  redirect(destination(next));
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseFormData(signUpSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { fullName, email, password } = parsed.data;

  const limited = await enforceAuthRateLimit("signup", email);
  if (limited) return { error: limited, values: { fullName, email } };

  const supabase = await createClient();
  // The public.users profile row is created by a database trigger on
  // auth.users insert (drizzle/0003_auth_user_triggers.sql), so it can't
  // drift from the auth record. full_name travels via user metadata.
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      // The confirmation link lands on our PKCE callback, which exchanges
      // the code for a session and then sends the user to their dashboard.
      emailRedirectTo: `${getSiteUrl()}/api/auth/callback?next=${encodeURIComponent("/dashboard")}`,
    },
  });

  if (error) {
    // Never reveal whether an email is already registered: an existing
    // account gets the same "check your email" message as a new one.
    // (With confirmations on, Supabase already obfuscates this case.)
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { success: SIGN_UP_SUCCESS };
    }
    if (error.code === "weak_password") {
      return {
        error: "That password is too easy to guess. Try a longer one.",
        fieldErrors: { password: ["That password is too easy to guess. Try a longer one."] },
        values: { fullName, email },
      };
    }
    if (error.code === "over_email_send_rate_limit") {
      return { error: "Too many sign-up attempts. Please try again later.", values: { fullName, email } };
    }
    logger.error("auth.sign_up_failed", { err: error });
    return { error: "Sign up is unavailable right now. Please try again.", values: { fullName, email } };
  }

  return { success: SIGN_UP_SUCCESS };
}

export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseFormData(resetRequestSchema, formData);
  if (!parsed.ok) return parsed.state;
  const { email } = parsed.data;

  const limited = await enforceAuthRateLimit("reset_request", email);
  if (limited) return { error: limited, values: { email } };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Callback exchanges the recovery code for a session, then lands on the
    // update-password form (which requires that session).
    redirectTo: `${getSiteUrl()}/api/auth/callback?next=${encodeURIComponent("/update-password")}`,
  });

  // Always return success to avoid leaking whether an email exists
  if (error) logger.error("auth.password_reset_failed", { err: error });
  return { success: "If that email is registered, a reset link is on its way." };
}

export async function updatePassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseFormData(updatePasswordSchema, formData);
  if (!parsed.ok) return parsed.state;

  // Requires the (recovery) session the callback route established. Checked
  // here as well as in proxy.ts: never trust the gate in front of you.
  const user = await getCurrentUser();
  if (!user) return { error: "Your reset link has expired. Please request a new one." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { error: "Choose a password you haven't used before." };
    }
    if (error.code === "weak_password") {
      return { error: "That password is too easy to guess. Try a longer one." };
    }
    logger.error("auth.update_password_failed", { userId: user.id, err: error });
    return { error: "We couldn't update your password. Please try again." };
  }

  redirect(homeForRole(user.role));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
