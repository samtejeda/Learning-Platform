import type { InputHTMLAttributes } from "react";
import { Input } from "./input";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  /** Validation message(s) for this field; renders below the input. */
  errors?: string[];
  /** Helper text shown under the input when there is no error. */
  hint?: string;
};

/** Label + input + error/hint, with the ARIA wiring done. */
export function Field({ label, name, errors, hint, id, ...props }: FieldProps) {
  const inputId = id ?? name;
  const hasError = !!errors?.length;
  const describedBy = hasError ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <Input
        id={inputId}
        name={name}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hasError ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-red-600">
          {errors![0]}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
