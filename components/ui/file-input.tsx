import type { InputHTMLAttributes, Ref } from "react";

// One styled native file picker for every upload form (DESIGN.md text-input
// look: canvas fill, dashed hairline, 8px radius, coral focus ring). Native
// control kept on purpose: it's what phones use to offer camera/files, and it
// is keyboard- and screen-reader-complete for free. `min-h-11` = 44px tap target.
export const fileInputClassName =
  "block min-h-11 w-full cursor-pointer rounded-md border border-dashed border-hairline bg-canvas p-2 text-sm text-body file:mr-3 file:cursor-pointer file:rounded-sm file:border-0 file:bg-surface-cream-strong file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-hairline focus:focus-ring disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-error";

export function FileInput({
  className = "",
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} type="file" className={`${fileInputClassName} ${className}`} {...props} />;
}
