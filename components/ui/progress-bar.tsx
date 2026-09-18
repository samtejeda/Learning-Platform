type Props = {
  /** 0–100 */
  value: number;
  label: string;
  /** Short text to the right (e.g. "3 of 8"). */
  caption?: string;
  size?: "sm" | "md";
  /** Unknown progress (e.g. an upload without byte-level events). */
  indeterminate?: boolean;
};

export function ProgressBar({ value, label, caption, size = "sm", indeterminate }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const done = pct >= 100;
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuetext={indeterminate ? "In progress" : undefined}
        className={`relative flex-1 overflow-hidden rounded-pill bg-hairline ${size === "sm" ? "h-1.5" : "h-2.5"}`}
      >
        {indeterminate ? (
          <div className="absolute inset-y-0 w-1/3 animate-[progress-slide_1.4s_ease-in-out_infinite] rounded-pill bg-primary" />
        ) : (
          <div
            className={`h-full rounded-pill transition-[width] duration-300 ${done ? "bg-success" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {caption && <span className="shrink-0 text-xs font-medium tabular-nums text-muted">{caption}</span>}
    </div>
  );
}
