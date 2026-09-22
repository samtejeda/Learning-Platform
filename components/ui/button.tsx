import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm";

// DESIGN.md button-primary: coral fill, white label, 40px tall, 8px radius,
// darkens to primary-active on press. Secondary: canvas + hairline outline.
const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none transition-colors focus-visible:focus-ring disabled:cursor-not-allowed";

const sizes: Record<Size, string> = {
  md: "h-10 px-5 text-sm",
  sm: "h-9 px-3.5 text-sm",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-active active:bg-primary-active disabled:bg-primary-disabled disabled:text-muted",
  secondary:
    "bg-canvas text-ink border border-hairline hover:bg-surface-soft active:bg-surface-card disabled:text-muted-soft",
  ghost: "text-body hover:bg-surface-soft hover:text-ink active:bg-surface-card disabled:text-muted-soft",
  danger:
    "bg-canvas text-error border border-error/40 hover:bg-error/5 active:bg-error/10 disabled:text-muted-soft",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClassName(variant, fullWidth, size, className)} {...props} />;
}

/** For <Link> / <a> elements that should look like a button. */
export function buttonClassName(
  variant: Variant = "primary",
  fullWidth = false,
  size: Size = "md",
  extra = "",
) {
  return `${base} ${sizes[size]} ${variants[variant]} ${fullWidth ? "w-full" : ""} ${extra}`.trim();
}
