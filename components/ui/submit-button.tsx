"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/**
 * A submit button that disables itself and shows `pendingLabel` while the
 * enclosing <form action={…}> is running. Must be rendered inside the form.
 */
export function SubmitButton({
  children,
  pendingLabel = "Please wait…",
  ...props
}: Omit<ButtonProps, "type"> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth disabled={pending} aria-busy={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
