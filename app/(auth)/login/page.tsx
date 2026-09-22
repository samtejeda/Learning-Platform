"use client";

import { Suspense, useActionState, useId, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { signInWithEmail, sendPhoneOTP, verifyPhoneOTP } from "@/lib/auth/actions";
import type { ActionState } from "@/lib/validation/form";
import { AuthCard } from "@/components/auth-card";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";

type Tab = "email" | "phone";
const TABS: { id: Tab; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
];

export default function LoginPage() {
  // useSearchParams() needs a Suspense boundary so the shell can prerender.
  return (
    <Suspense fallback={<AuthCard title="Sign in" lead="Welcome back">{null}</AuthCard>}>
      <LoginCard />
    </Suspense>
  );
}

function LoginCard() {
  const [tab, setTab] = useState<Tab>("email");
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? undefined;
  const linkError = searchParams.get("error");
  const baseId = useId();

  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const nextTab = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    setTab(nextTab.id);
    document.getElementById(`${baseId}-tab-${nextTab.id}`)?.focus();
  }

  return (
    <AuthCard title="Sign in" lead="Welcome back">
      {linkError === "link" && (
        <div className="mb-4">
          <Alert tone="error">That link is invalid or has expired. Please request a new one.</Alert>
        </div>
      )}

      <div
        role="tablist"
        aria-label="Sign-in method"
        onKeyDown={onTabKeyDown}
        className="mb-6 flex gap-1 rounded-md bg-surface-cream-strong p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`${baseId}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`min-h-9 flex-1 rounded-sm text-sm font-medium transition-colors focus-visible:focus-ring ${
              tab === t.id ? "bg-canvas text-ink shadow-subtle" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id={`${baseId}-panel-${tab}`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`}>
        {tab === "email" ? <EmailForm next={next} /> : <PhoneForm next={next} />}
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Don&apos;t have an account? <TextLink href="/register">Sign up</TextLink>
      </p>
    </AuthCard>
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
      <p className="text-center text-sm text-muted">
        <TextLink href="/reset-password">Forgot password?</TextLink>
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
        <p className="text-sm text-muted">
          Code sent to <span className="font-medium text-ink">{phone}</span>
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
          autoFocus
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
          Use a different number
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
