"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp } from "@/lib/auth/actions";
import type { ActionState } from "@/lib/validation/form";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

export default function RegisterPage() {
  const [state, action] = useActionState<ActionState, FormData>(signUp, null);

  return (
    <Card>
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">Create account</h1>
      <p className="text-sm text-slate-500 mb-6">Sign up as a student</p>

      {state?.success ? (
        <Alert tone="success">{state.success}</Alert>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          {state?.error && <Alert tone="error">{state.error}</Alert>}
          <Field
            label="Full name"
            name="fullName"
            type="text"
            autoComplete="name"
            placeholder="Jane Smith"
            required
            maxLength={100}
            defaultValue={state?.values?.fullName}
            errors={state?.fieldErrors?.fullName}
          />
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            defaultValue={state?.values?.email}
            errors={state?.fieldErrors?.email}
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Min. 8 characters"
            required
            minLength={8}
            maxLength={72}
            errors={state?.fieldErrors?.password}
          />
          <Field
            label="Confirm password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            errors={state?.fieldErrors?.confirmPassword}
          />
          <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-slate-900 underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
