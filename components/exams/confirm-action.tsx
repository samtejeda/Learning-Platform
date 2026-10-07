"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/validation/form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Confirm = { title: string; body: string; confirmLabel: string };

/**
 * A button that runs a bound server action, optionally behind an inline
 * "are you sure?" panel (replaces window.confirm). Shows the action's message
 * and refreshes the page. Used for publish, unpublish and the deletes.
 */
export function ConfirmAction({
  action,
  children,
  variant = "secondary",
  confirm,
  disabled,
  disabledReason,
  busyLabel = "Please wait…",
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  confirm?: Confirm;
  disabled?: boolean;
  /** Always-visible text saying why the button is off. */
  disabledReason?: string;
  busyLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);
  const [asking, setAsking] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (asking) titleRef.current?.focus();
  }, [asking]);

  function run() {
    setAsking(false);
    start(async () => {
      const result = await action();
      setState(result);
      router.refresh();
    });
  }

  return (
    <div ref={wrapRef} className="space-y-2">
      {asking && confirm ? (
        <div role="group" aria-labelledby="confirm-action-title" className="space-y-3 rounded-md border border-primary bg-canvas p-4">
          <div>
            <h3 id="confirm-action-title" ref={titleRef} tabIndex={-1} className="font-sans text-base font-medium text-ink focus:outline-none">
              {confirm.title}
            </h3>
            <p className="mt-1 text-sm text-muted">{confirm.body}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="button" variant={variant === "danger" ? "danger" : "primary"} className="min-h-11" onClick={run}>
              {confirm.confirmLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => {
                setAsking(false);
                requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
              }}
            >
              Keep it as it is
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant={variant}
          className="min-h-11"
          disabled={disabled || pending}
          aria-busy={pending}
          onClick={() => (confirm ? setAsking(true) : run())}
        >
          {pending ? busyLabel : children}
        </Button>
      )}
      {disabled && disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {state?.fieldErrors?._publish && (
        <Alert tone="warning">
          <ul className="list-disc pl-4">
            {state.fieldErrors._publish.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {state?.success && <Alert tone="success">{state.success}</Alert>}
    </div>
  );
}
