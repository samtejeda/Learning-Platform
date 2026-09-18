import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// DESIGN.md text-input: canvas background, 1px hairline, 40px tall, 8px
// radius; focus = coral border + 3px coral ring. `text-base` on phones keeps
// iOS from zooming the page on focus; desktop drops to 14px.
export const controlClassName =
  "w-full rounded-md border border-hairline bg-canvas px-3.5 text-base sm:text-sm text-ink placeholder:text-muted-soft focus:focus-ring disabled:bg-surface-soft disabled:text-muted aria-[invalid=true]:border-error";

export const inputClassName = `${controlClassName} h-10`;

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClassName} ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  rows = 4,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={`${controlClassName} py-2.5 leading-relaxed ${className}`} {...props} />;
}

const chevron =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%236c6a64' stroke-width='1.5'><path d='M4 6l4 4 4-4'/></svg>\")";

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`${inputClassName} appearance-none bg-no-repeat bg-[right_0.75rem_center] pr-9 ${className}`}
      style={{ backgroundImage: chevron }}
      {...props}
    >
      {children}
    </select>
  );
}
