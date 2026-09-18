import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Input, Select, Textarea } from "./input";

type ShellProps = {
  label: string;
  /** id of the control; also used for the error/hint ids. */
  id: string;
  errors?: string[];
  hint?: string;
  /** Visually mark the field as optional. */
  optional?: boolean;
  children: ReactNode;
};

/** Label + control slot + error/hint with the ARIA ids wired. */
export function FieldShell({ label, id, errors, hint, optional, children }: ShellProps) {
  const hasError = !!errors?.length;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-ink">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-muted-soft">Optional</span>}
      </label>
      {children}
      {hasError ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-error">
          {errors![0]}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Props the control needs to point at the shell's error/hint text. */
export function controlAria(id: string, errors?: string[], hint?: string) {
  const hasError = !!errors?.length;
  return {
    id,
    "aria-invalid": hasError || undefined,
    "aria-describedby": hasError ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

type Common = { label: string; name: string; errors?: string[]; hint?: string; optional?: boolean };

export function Field({
  label,
  name,
  errors,
  hint,
  optional,
  id,
  ...props
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  const controlId = id ?? name;
  return (
    <FieldShell label={label} id={controlId} errors={errors} hint={hint} optional={optional}>
      <Input name={name} {...controlAria(controlId, errors, hint)} {...props} />
    </FieldShell>
  );
}

export function TextareaField({
  label,
  name,
  errors,
  hint,
  optional,
  id,
  ...props
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const controlId = id ?? name;
  return (
    <FieldShell label={label} id={controlId} errors={errors} hint={hint} optional={optional}>
      <Textarea name={name} {...controlAria(controlId, errors, hint)} {...props} />
    </FieldShell>
  );
}

export function SelectField({
  label,
  name,
  errors,
  hint,
  optional,
  id,
  children,
  ...props
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const controlId = id ?? name;
  return (
    <FieldShell label={label} id={controlId} errors={errors} hint={hint} optional={optional}>
      <Select name={name} {...controlAria(controlId, errors, hint)} {...props}>
        {children}
      </Select>
    </FieldShell>
  );
}
