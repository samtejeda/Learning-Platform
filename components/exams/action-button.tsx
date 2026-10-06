"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/validation/form";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/** A button that runs a bound server action, then shows its message and refreshes. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  confirmMessage,
}: {
  action: () => Promise<ActionState>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  confirmMessage?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirmMessage && !window.confirm(confirmMessage)) return;
          start(async () => {
            const result = await action();
            setState(result);
            router.refresh();
          });
        }}
      >
        {pending ? "Please wait…" : children}
      </Button>
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
