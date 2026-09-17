"use client";

import { useActionState } from "react";
import { updatePassword } from "@/lib/auth/actions";
import type { ActionState } from "@/lib/validation/form";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Reached from the password-reset email via /api/auth/callback, which has
 * already turned the link into a (recovery) session. Not a public route:
 * proxy.ts sends signed-out visitors to /login.
 */
export default function UpdatePasswordPage() {
  const [state, action] = useActionState<ActionState, FormData>(updatePassword, null);

  return (
    <Card>
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">Choose a new password</h1>
      <p className="text-sm text-slate-500 mb-6">You&apos;ll be signed in once it&apos;s saved.</p>

      <form action={action} className="space-y-4" noValidate>
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        <Field
          label="New password"
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
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
          errors={state?.fieldErrors?.confirmPassword}
        />
        <SubmitButton pendingLabel="Saving…">Save password</SubmitButton>
      </form>
    </Card>
  );
}
