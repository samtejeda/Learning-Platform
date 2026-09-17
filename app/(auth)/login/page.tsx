"use client";

import { Suspense, useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signInWithEmail, sendPhoneOTP, verifyPhoneOTP } from "@/lib/auth/actions";
import type { ActionState } from "@/lib/validation/form";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

type Tab = "email" | "phone";

export default function LoginPage() {
  // useSearchParams() needs a Suspense boundary so the shell can prerender.
  return (
    <Suspense fallback={<Card><h1 className="text-2xl font-semibold text-slate-900">Sign in</h1></Card>}>
      <LoginCard />
    </Suspense>
  );
}

function LoginCard() {
  const [tab, setTab] = useState<Tab>("email");
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? undefined;
  const linkError = searchParams.get("error");

  return (
    <Card>
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">Welcome back</p>

      {linkError === "link" && (
        <div className="mb-4">
          <Alert tone="error">That link is invalid or has expired. Please request a new one.</Alert>
        </div>
      )}

      <div role="tablist" className="flex rounded-lg bg-slate-100 p-1 mb-6 gap-1">
        {(["email", "phone"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "email" ? "Email" : "Phone"}
          </button>
        ))}
      </div>

      {tab === "email" ? <EmailForm next={next} /> : <PhoneForm next={next} />}

      <p className="mt-6 text-center text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-slate-900 underline underline-offset-2">
          Sign up
        </Link>
      </p>
    </Card>
  );
}

function EmailForm({ next }: { next?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(signInWithEmail, null);

  return (
    <form action={action} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
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
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
        errors={state?.fieldErrors?.password}
      />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      <p className="text-center text-sm text-slate-500">
        <Link href="/reset-password" className="text-slate-700 underline underline-offset-2">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}

function PhoneForm({ next }: { next?: string }) {
  const [step, setStep] = useState<"enter" | "verify">("enter");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<ActionState>(null);
  const [isPending, startTransition] = useTransition();

  function handleSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get("phone");
    startTransition(async () => {
      const result = await sendPhoneOTP({ phone: String(value ?? "") });
      setState(result);
      if (result?.success) {
        setPhone(result.values?.phone ?? String(value ?? ""));
        setStep("verify");
      }
    });
  }

  function handleVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = new FormData(e.currentTarget).get("token");
    startTransition(async () => {
      const result = await verifyPhoneOTP({ phone, token: String(token ?? ""), next });
      // On success the action redirects and never resolves here.
      setState(result);
    });
  }

  if (step === "verify") {
    return (
      <form onSubmit={handleVerify} className="space-y-4" noValidate>
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        <p className="text-sm text-slate-500">
          Code sent to <span className="font-medium text-slate-700">{phone}</span>
        </p>
        <Field
          label="Verification code"
          name="token"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={6}
          required
          errors={state?.fieldErrors?.token}
        />
        <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
          {isPending ? "Verifying…" : "Verify code"}
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onClick={() => {
            setStep("enter");
            setState(null);
          }}
        >
          ← Back
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSend} className="space-y-4" noValidate>
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <Field
        label="Phone number"
        name="phone"
        type="tel"
        autoComplete="tel"
        placeholder="+1 555 123 4567"
        required
        defaultValue={state?.values?.phone}
        errors={state?.fieldErrors?.phone}
        hint="Include your country code (e.g. +1). Phone sign-in works for accounts that already have a phone number."
      />
      <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
        {isPending ? "Sending…" : "Send code"}
      </Button>
    </form>
  );
}
