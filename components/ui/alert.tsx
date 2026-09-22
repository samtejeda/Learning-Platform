import type { ReactNode } from "react";

type Tone = "error" | "success" | "info" | "warning";

const tones: Record<Tone, string> = {
  error: "border-error/30 bg-error/8 text-error",
  success: "border-success/40 bg-success/10 text-success-strong",
  warning: "border-warning/40 bg-warning/10 text-warning-strong",
  info: "border-hairline bg-surface-soft text-body",
};

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-3.5 py-2.5 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
