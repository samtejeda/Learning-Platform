"use client";

import { useActionState } from "react";
import { signUp } from "@/lib/auth/actions";
import type { ActionState } from "@/lib/validation/form";
import { AuthCard } from "@/components/auth-card";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextLink } from "@/components/ui/text-link";

export default function RegisterPage() {
  const [state, action] = useActionState<ActionState, FormData>(signUp, null);

  return (
    <AuthCard title="Create account" lead="Sign up as a student">
      {state?.success ? (
        <div className="space-y-4">
          <Alert tone="success">{state.success}</Alert>
          <p className="text-center text-sm text-muted">
            <TextLink href="/resend-confirmation">Didn&apos;t get it?</TextLink>
          </p>
        </div>
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

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <TextLink href="/login">Sign in</TextLink>
      </p>
    </AuthCard>
  );
}
