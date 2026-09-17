import type { ReactNode } from "react";

type Tone = "error" | "success" | "info";

const tones: Record<Tone, string> = {
  error: "text-red-700 bg-red-50 border-red-200",
  success: "text-green-700 bg-green-50 border-green-200",
  info: "text-slate-700 bg-slate-50 border-slate-200",
};

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`text-sm border rounded-lg px-3 py-2 ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
