"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resendConfirmation } from "@/lib/auth/actions";
import type { ActionState } from "@/lib/validation/form";
import { AuthCard } from "@/components/auth-card";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClassName } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";

export default function ResendConfirmationPage() {
  const [state, action] = useActionState<ActionState, FormData>(resendConfirmation, null);

  return (
    <AuthCard
      title="Resend confirmation"
      lead="Enter the email you signed up with and we'll send a new confirmation link."
    >
      {state?.success ? (
        <div className="space-y-4">
          <Alert tone="success">{state.success}</Alert>
          <Link href="/login" className={buttonClassName("primary", true)}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          {state?.error && <Alert tone="error">{state.error}</Alert>}
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
          <SubmitButton pendingLabel="Sending…">Resend confirmation link</SubmitButton>
          <p className="text-center text-sm text-muted">
            <TextLink href="/login">Back to sign in</TextLink>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
