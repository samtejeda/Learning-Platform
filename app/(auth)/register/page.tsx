"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signUp } from "@/lib/auth/actions";

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await signUp(null, formData);
      if (result?.error) setError(result.error);
      else if (result?.success) setSuccess(result.success);
    });
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">Create account</h1>
      <p className="text-sm text-slate-500 mb-6">Sign up as a student</p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {success ? (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          {success}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Full name" name="fullName" type="text" autoComplete="name" placeholder="Jane Smith" />
          <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
          <Field label="Password" name="password" type="password" autoComplete="new-password" placeholder="Min. 8 characters" />
          <Field label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password" placeholder="••••••••" />

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? "Creating account…" : "Create account"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-slate-900 underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  placeholder,
  autoComplete,
}: {
  label: string;
  name: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
      />
    </div>
  );
}
