"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signInWithEmail(_: unknown, formData: FormData) {
  const email = (formData.get("email") as string).trim().toLowerCase();
  const password = formData.get("password") as string;

  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: error.message };

  redirect("/dashboard");
}

export async function sendPhoneOTP(phone: string) {
  const normalized = phone.trim();
  if (!normalized) return { error: "Phone number is required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: normalized });

  if (error) return { error: error.message };
  return { success: true };
}

export async function verifyPhoneOTP(phone: string, token: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: "sms",
  });

  if (error) return { error: error.message };

  redirect("/dashboard");
}

export async function signUp(_: unknown, formData: FormData) {
  const fullName = (formData.get("fullName") as string).trim();
  const email = (formData.get("email") as string).trim().toLowerCase();
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!fullName || !email || !password)
    return { error: "All fields are required." };
  if (password !== confirmPassword)
    return { error: "Passwords do not match." };
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };

  const supabase = await createClient();
  // The public.users profile row is created by a database trigger on
  // auth.users insert (drizzle/0003_auth_user_triggers.sql), so it can't
  // drift from the auth record. full_name travels via user metadata.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) return { error: error.message };
  if (!data.user) return { error: "Sign up failed. Please try again." };

  return {
    success:
      "Account created! Check your email to confirm before signing in.",
  };
}

export async function requestPasswordReset(_: unknown, formData: FormData) {
  const email = (formData.get("email") as string).trim().toLowerCase();
  if (!email) return { error: "Email is required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/update-password`,
  });

  // Always return success to avoid leaking whether an email exists
  if (error) console.error("Password reset error:", error.message);
  return { success: "If that email is registered, a reset link is on its way." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
