"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signInWithEmail, sendPhoneOTP, verifyPhoneOTP } from "@/lib/auth/actions";

type Tab = "email" | "phone";
type PhoneStep = "enter" | "verify";

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>("email");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("enter");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await signInWithEmail(null, formData);
      if (result?.error) setError(result.error);
    });
  }

  function handleSendOTP(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await sendPhoneOTP(phone);
      if (result?.error) setError(result.error);
      else setPhoneStep("verify");
    });
  }

  function handleVerifyOTP(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const token = (e.currentTarget.elements.namedItem("token") as HTMLInputElement).value;
    startTransition(async () => {
      const result = await verifyPhoneOTP(phone, token);
      if (result?.error) setError(result.error);
    });
  }

  function switchTab(t: Tab) {
    setTab(t);
    setPhoneStep("enter");
    setPhone("");
    setError(null);
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
      <h1 className="text-2xl font-semibold text-slate-900 mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">Welcome back</p>

      {/* Tabs */}
      <div className="flex rounded-lg bg-slate-100 p-1 mb-6 gap-1">
        {(["email", "phone"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "email" ? "Email" : "Phone"}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {/* Email form */}
      {tab === "email" && (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
          <Field label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" />
          <SubmitButton loading={isPending}>Sign in</SubmitButton>
          <p className="text-center text-sm text-slate-500">
            <Link href="/reset-password" className="text-slate-700 underline underline-offset-2">
              Forgot password?
            </Link>
          </p>
        </form>
      )}

      {/* Phone form — step 1 */}
      {tab === "phone" && phoneStep === "enter" && (
        <form onSubmit={handleSendOTP} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Phone number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 234 567 8900"
              autoComplete="tel"
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
            <p className="mt-1.5 text-xs text-slate-400">Include country code (e.g. +1)</p>
          </div>
          <SubmitButton loading={isPending}>Send OTP code</SubmitButton>
        </form>
      )}

      {/* Phone form — step 2 */}
      {tab === "phone" && phoneStep === "verify" && (
        <form onSubmit={handleVerifyOTP} className="space-y-4">
          <p className="text-sm text-slate-500">
            Code sent to <span className="font-medium text-slate-700">{phone}</span>
          </p>
          <Field label="Verification code" name="token" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
          <SubmitButton loading={isPending}>Verify code</SubmitButton>
          <button
            type="button"
            onClick={() => { setPhoneStep("enter"); setError(null); }}
            className="w-full text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-slate-900 underline underline-offset-2">
          Sign up
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
  inputMode,
}: {
  label: string;
  name: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
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
        inputMode={inputMode}
        required
        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
      />
    </div>
  );
}

function SubmitButton({ children, loading }: { children: React.ReactNode; loading: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}
