import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

// DESIGN.md text-link is coral; we use the darker `primary-active` so inline
// links clear WCAG AA on the cream canvas, and lighten to coral on hover.
export const textLinkClassName =
  "font-medium text-primary-active underline underline-offset-2 hover:text-primary focus-visible:rounded-sm focus-visible:focus-ring";

export function TextLink({
  className = "",
  children,
  ...props
}: LinkProps & AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  return (
    <Link className={`${textLinkClassName} ${className}`} {...props}>
      {children}
    </Link>
  );
}
