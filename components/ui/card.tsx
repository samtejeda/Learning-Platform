import type { HTMLAttributes } from "react";

type Variant = "cream" | "outlined" | "dark";

// DESIGN.md: color-block first, no shadow. `cream` = feature-card
// (surface-card), `outlined` = canvas + hairline (model-comparison-card),
// `dark` = surface-dark (product-mockup-card-dark).
const variants: Record<Variant, string> = {
  cream: "bg-surface-card text-body",
  outlined: "bg-canvas text-body border border-hairline",
  dark: "bg-surface-dark text-on-dark",
};

export function Card({
  variant = "cream",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: Variant }) {
  return <div className={`rounded-lg p-5 sm:p-8 ${variants[variant]} ${className}`} {...props} />;
}

/** Section heading inside a card: sans, 18px/500 (DESIGN.md title-md). */
export function CardTitle({ className = "", ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={`font-sans text-lg font-medium tracking-normal text-ink ${className}`} {...props} />
  );
}
