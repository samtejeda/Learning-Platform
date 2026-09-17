"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/auth/actions";
import type { ActionState } from "@/lib/validation/form";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClassName } from "@/components/ui/button";

export default function ResetPasswordPage() {
  const [state, action] = useActionState<ActionState, FormData>(requestPasswordReset, null);

  return (
    <Card>
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">Reset password</h1>
      <p className="text-sm text-slate-500 mb-6">
        Enter your email and we&apos;ll send a reset link.
      </p>

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
          <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
          <p className="text-center text-sm text-slate-500">
            <Link href="/login" className="text-slate-700 underline underline-offset-2">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </Card>
  );
}
