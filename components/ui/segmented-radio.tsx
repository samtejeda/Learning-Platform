import type { ReactNode } from "react";

// A radio group drawn like the sign-in tabs (cream track, canvas "thumb"):
// one tap on a phone instead of a native picker, and still a real
// <fieldset> of radios, so arrow keys, form submission and screen readers
// work with no JS. Use for a small, always-visible either/or choice.
export function SegmentedRadio<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  disabled,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: ReactNode }[];
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-ink">{legend}</legend>
      <div className="flex gap-1 rounded-md bg-surface-cream-strong p-1">
        {options.map((option) => (
          <label key={option.value} className="flex-1">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="flex min-h-10 cursor-pointer items-center justify-center rounded-sm px-3 text-sm font-medium text-muted transition-colors hover:text-ink peer-checked:bg-canvas peer-checked:text-ink peer-checked:shadow-subtle peer-focus-visible:focus-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-60">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
