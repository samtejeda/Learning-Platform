import type { HTMLAttributes } from "react";

type Tone = "neutral" | "coral" | "success" | "warning" | "outline";

// DESIGN.md badge-pill (surface-card, 13px/500) and badge-coral (uppercase
// 12px, 1.5px tracking). Semantic tones use the darker "-strong" text tokens
// for contrast on cream.
const tones: Record<Tone, string> = {
  neutral: "bg-surface-card text-ink",
  coral: "bg-primary text-on-primary uppercase tracking-[1.5px] text-xs",
  success: "bg-success/12 text-success-strong",
  warning: "bg-warning/12 text-warning-strong",
  outline: "border border-hairline text-muted",
};

export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-3 py-1 text-[13px] font-medium leading-tight ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
