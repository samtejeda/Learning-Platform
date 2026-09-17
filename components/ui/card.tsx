import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8 ${className}`}
      {...props}
    />
  );
}
